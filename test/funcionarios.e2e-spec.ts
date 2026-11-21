import { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { CatalogoAcessoService } from '../src/modulos/acesso/aplicacao/catalogo-acesso.service';
import { FilaEmailService } from '../src/modulos/notificacao/aplicacao/fila-email.service';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';

const SENHA = 'senhaForte1';

describe('UC-19 · Funcionários da empresa (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let empresaId: string;
  let outraEmpresaId: string;
  let perfis: Record<string, string>;
  let tokenEmpresa: string;
  const convites: string[] = [];

  const http = () => request(app.getHttpServer());
  const entrar = async (email: string, senha = SENHA) =>
    (
      (await http().post('/v1/auth/login').send({ email, senha }).expect(200))
        .body as { accessToken: string }
    ).accessToken;

  async function criarEmpresa(email: string, cnpj: string) {
    const perfil = await prisma.perfilAcesso.findFirstOrThrow({
      where: { nome: 'Empresa', escopo: 'GLOBAL' },
    });
    const usuario = await prisma.usuario.create({
      data: {
        email,
        senhaHash: await hash(SENHA),
        emailConfirmado: true,
        status: 'ATIVA',
        tentativasLoginFalhas: 0,
        dataCadastro: new Date(),
        perfilId: perfil.id,
      },
    });
    await prisma.empresaEnterprise.create({
      data: {
        id: usuario.id,
        cnpj,
        razaoSocial: `${email} Ltda.`,
        nomeFantasia: 'Clínica Teste',
        tipo: 'CLINICA_VETERINARIA',
        enderecoCep: '05400000',
        enderecoLogradouro: 'Rua A',
        enderecoNumero: '1',
        enderecoBairro: 'Centro',
        enderecoCidade: 'São Paulo',
        enderecoUf: 'SP',
      },
    });
    await app.get(CatalogoAcessoService).criarPerfisDaEmpresa(usuario.id);
    return usuario.id;
  }

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    jest
      .spyOn(app.get(FilaEmailService), 'enviar')
      .mockImplementation((_tipo, _para, dados) => {
        convites.push((dados as { link: string }).link);
        return Promise.resolve();
      });
    empresaId = await criarEmpresa('empresa@exemplo.com', '11222333000181');
    outraEmpresaId = await criarEmpresa('outra@exemplo.com', '45556667000123');
    const lista = await prisma.perfilAcesso.findMany({ where: { empresaId } });
    perfis = Object.fromEntries(lista.map((p) => [p.nome, p.id]));
    tokenEmpresa = await entrar('empresa@exemplo.com');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const comEmpresa = (r: request.Test) =>
    r.set('Authorization', `Bearer ${tokenEmpresa}`);

  it('CT-19-01: deve ativar o funcionário com o perfil escolhido quando ele cria a senha pelo convite', async () => {
    const criado = await comEmpresa(
      http().post(`/v1/empresas/${empresaId}/funcionarios`),
    )
      .send({
        nome: 'Rafa Souza',
        cpf: '52998224725',
        email: 'rafa@exemplo.com',
        cargo: 'Recepção',
        perfilId: perfis['Atendente'],
      })
      .expect(201);
    expect(criado.body).toMatchObject({
      nome: 'Rafa Souza',
      perfil: 'Atendente',
      ativo: true,
    });

    const token = decodeURIComponent(
      convites[convites.length - 1].split('token=')[1],
    );
    await http().post('/v1/auth/confirmacao').send({ token }).expect(422);
    await http()
      .post('/v1/auth/confirmacao')
      .send({ token, senha: SENHA })
      .expect(204);

    const tokenFuncionario = await entrar('rafa@exemplo.com');
    const conteudo = JSON.parse(
      Buffer.from(tokenFuncionario.split('.')[1], 'base64url').toString(),
    ) as {
      tipo: string;
      empresaId: string;
      perfil: string;
    };
    expect(conteudo).toMatchObject({
      tipo: 'FUNCIONARIO',
      empresaId,
      perfil: 'Atendente',
    });

    // O Atendente não gerencia a equipe (RN20).
    await http()
      .get(`/v1/empresas/${empresaId}/funcionarios`)
      .set('Authorization', `Bearer ${tokenFuncionario}`)
      .expect(403);
  });

  it('deve listar só a equipe da própria empresa', async () => {
    const lista = await comEmpresa(
      http().get(`/v1/empresas/${empresaId}/funcionarios`),
    ).expect(200);
    expect((lista.body as { email: string }[]).map((f) => f.email)).toEqual([
      'rafa@exemplo.com',
    ]);
    await comEmpresa(
      http().get(`/v1/empresas/${outraEmpresaId}/funcionarios`),
    ).expect(403);
  });

  it('deve recusar perfil de outra empresa e CPF repetido', async () => {
    const perfilDeOutra = await prisma.perfilAcesso.findFirstOrThrow({
      where: { empresaId: outraEmpresaId },
    });
    await comEmpresa(http().post(`/v1/empresas/${empresaId}/funcionarios`))
      .send({
        nome: 'X',
        cpf: '11144477735',
        email: 'x@exemplo.com',
        perfilId: perfilDeOutra.id,
      })
      .expect(422);
    const repetido = await comEmpresa(
      http().post(`/v1/empresas/${empresaId}/funcionarios`),
    )
      .send({
        nome: 'Y',
        cpf: '52998224725',
        email: 'y@exemplo.com',
        perfilId: perfis['Atendente'],
      })
      .expect(409);
    expect(repetido.body).toMatchObject({ codigo: 'RN01_CPF_EM_USO' });
  });

  it('deve aplicar o perfil novo quando a empresa troca o perfil do funcionário (UC-16)', async () => {
    const funcionario = await prisma.usuario.findUniqueOrThrow({
      where: { email: 'rafa@exemplo.com' },
    });
    const alterado = await comEmpresa(
      http().patch(`/v1/funcionarios/${funcionario.id}`),
    )
      .send({ perfilId: perfis['Proprietário'] })
      .expect(200);
    expect(alterado.body).toMatchObject({ perfil: 'Proprietário' });
    const tokenNovo = await entrar('rafa@exemplo.com');
    await http()
      .get(`/v1/empresas/${empresaId}/funcionarios`)
      .set('Authorization', `Bearer ${tokenNovo}`)
      .expect(200);
  });

  it('CT-19-02: deve revogar todas as sessões na hora quando a empresa remove o funcionário (RN23)', async () => {
    const funcionario = await prisma.usuario.findUniqueOrThrow({
      where: { email: 'rafa@exemplo.com' },
    });
    const tokenFuncionario = await entrar('rafa@exemplo.com');
    const comFuncionario = () =>
      http()
        .get(`/v1/empresas/${empresaId}/funcionarios`)
        .set('Authorization', `Bearer ${tokenFuncionario}`);
    await comFuncionario().expect(200);

    await comEmpresa(
      http().delete(`/v1/funcionarios/${funcionario.id}`),
    ).expect(204);

    await comFuncionario().expect(401);
    const login = await http()
      .post('/v1/auth/login')
      .send({ email: 'rafa@exemplo.com', senha: SENHA })
      .expect(403);
    expect(login.body).toMatchObject({ codigo: 'CONTA_INDISPONIVEL' });
    expect(
      await prisma.sessao.count({ where: { usuarioId: funcionario.id } }),
    ).toBe(0);
  });
});
