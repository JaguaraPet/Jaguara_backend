import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { FilaEmailService } from '../src/modulos/notificacao/aplicacao/fila-email.service';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';

const tutor = {
  nome: 'Ana Ribeiro',
  cpf: '52998224725',
  email: 'ana.cadastro@exemplo.com',
  senha: 'senhaForte1',
  aceiteTermos: true,
};

const empresa = {
  cnpj: '11222333000181',
  razaoSocial: 'Clínica Teste Ltda.',
  nomeFantasia: 'Clínica Teste',
  tipo: 'CLINICA_VETERINARIA',
  email: 'clinica.cadastro@exemplo.com',
  senha: 'senhaForte1',
  endereco: {
    cep: '05400000',
    logradouro: 'Rua A',
    numero: '10',
    bairro: 'Centro',
    cidade: 'São Paulo',
    uf: 'SP',
  },
  aceiteTermos: true,
};

describe('UC-01 e UC-32 · Cadastro com confirmação de e-mail (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  const links: string[] = [];

  const http = () => request(app.getHttpServer());
  const tokenDoUltimoLink = () =>
    decodeURIComponent(links[links.length - 1].split('token=')[1]);

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    jest
      .spyOn(app.get(FilaEmailService), 'enviar')
      .mockImplementation((_tipo, _para, dados) => {
        links.push((dados as { link: string }).link);
        return Promise.resolve();
      });
    for (const tipo of [
      'TERMOS_USO_APP',
      'TERMOS_ENTERPRISE',
      'POLITICA_PRIVACIDADE',
    ] as const) {
      await prisma.termoUso.create({
        data: {
          tipo,
          versao: '1.0',
          titulo: tipo,
          conteudo: 'Texto',
          dataVigencia: new Date('2026-11-01'),
          obrigatorio: true,
        },
      });
    }
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('CT-01-01: deve ativar a conta do tutor quando ele confirma o e-mail', async () => {
    const resposta = await http()
      .post('/v1/auth/cadastro/tutor')
      .send(tutor)
      .expect(201);
    expect(resposta.body).toMatchObject({
      email: tutor.email,
      status: 'PENDENTE_CONFIRMACAO',
      perfil: 'Tutor',
    });

    // Antes de confirmar, não entra (RN02).
    await http()
      .post('/v1/auth/login')
      .send({ email: tutor.email, senha: tutor.senha })
      .expect(403);

    await http()
      .post('/v1/auth/confirmacao')
      .send({ token: tokenDoUltimoLink() })
      .expect(204);
    await http()
      .post('/v1/auth/login')
      .send({ email: tutor.email, senha: tutor.senha })
      .expect(200);

    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { email: tutor.email },
      include: { tutor: true, consentimento: true },
    });
    expect(usuario.status).toBe('ATIVA');
    expect(
      Buffer.from(usuario.tutor!.cpfCifrado).toString('utf8'),
    ).not.toContain(tutor.cpf);
    expect(usuario.consentimento).toHaveLength(2);
  });

  it('deve recusar o mesmo link de confirmação na segunda vez', async () => {
    await http()
      .post('/v1/auth/confirmacao')
      .send({ token: tokenDoUltimoLink() })
      .expect(410);
  });

  it('CT-01-02: deve recusar o cadastro quando o CPF já está em uso (RN01)', async () => {
    const resposta = await http()
      .post('/v1/auth/cadastro/tutor')
      .send({ ...tutor, email: 'outro@exemplo.com' })
      .expect(409);
    expect(resposta.body).toMatchObject({ codigo: 'RN01_CPF_EM_USO' });
  });

  it('CT-01-03: não deve concluir o cadastro sem o aceite dos termos (RN42)', async () => {
    const resposta = await http()
      .post('/v1/auth/cadastro/tutor')
      .send({
        ...tutor,
        cpf: '11144477735',
        email: 'sem.aceite@exemplo.com',
        aceiteTermos: false,
      })
      .expect(422);
    expect(resposta.body).toMatchObject({ codigo: 'DADOS_INVALIDOS' });
  });

  it('deve recusar CPF com dígitos verificadores errados', async () => {
    const resposta = await http()
      .post('/v1/auth/cadastro/tutor')
      .send({ ...tutor, cpf: '52998224724', email: 'cpf.errado@exemplo.com' })
      .expect(422);
    expect(resposta.body).toMatchObject({ campos: [{ campo: 'cpf' }] });
  });

  it('deve recusar e-mail já cadastrado', async () => {
    await http()
      .post('/v1/auth/cadastro/tutor')
      .send({ ...tutor, cpf: '11144477735', email: tutor.email.toUpperCase() })
      .expect(409);
  });

  it('deve cadastrar a empresa com os perfis padrão e recusar o CNPJ repetido (UC-32, RN01)', async () => {
    const resposta = await http()
      .post('/v1/auth/cadastro/empresa')
      .send(empresa)
      .expect(201);
    const perfis = await prisma.perfilAcesso.findMany({
      where: { empresaId: (resposta.body as { id: string }).id },
      orderBy: { nome: 'asc' },
    });
    expect(perfis.map((p) => p.nome)).toEqual([
      'Atendente',
      'Profissional',
      'Proprietário',
    ]);

    const repetida = await http()
      .post('/v1/auth/cadastro/empresa')
      .send({ ...empresa, email: 'outra.clinica@exemplo.com' })
      .expect(409);
    expect(repetida.body).toMatchObject({ codigo: 'RN01_CNPJ_EM_USO' });
  });

  it('deve recusar link de confirmação desconhecido', async () => {
    await http()
      .post('/v1/auth/confirmacao')
      .send({ token: 'nao-existe' })
      .expect(410);
  });
});
