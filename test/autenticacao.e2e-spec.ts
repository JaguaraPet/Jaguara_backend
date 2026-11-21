import { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';

const SENHA = 'Senha@Forte123';

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiraEm: string;
}

describe('UC-02 · Autenticar usuário (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let perfilId: string;

  const http = () => request(app.getHttpServer());

  async function criarTutor(
    email: string,
    extra: Record<string, unknown> = {},
  ) {
    return prisma.usuario.create({
      data: {
        email,
        senhaHash: await hash(SENHA),
        emailConfirmado: true,
        status: 'ATIVA',
        tentativasLoginFalhas: 0,
        dataCadastro: new Date(),
        perfilId,
        ...extra,
      },
    });
  }

  async function entrar(email: string): Promise<Tokens> {
    const resposta = await http()
      .post('/v1/auth/login')
      .send({ email, senha: SENHA })
      .expect(200);
    return resposta.body as Tokens;
  }

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    const permissao = await prisma.permissao.create({
      data: { codigo: 'pet:ler', modulo: 'pet', descricao: 'Ver pets' },
    });
    perfilId = (
      await prisma.perfilAcesso.create({
        data: {
          nome: 'Tutor',
          escopo: 'GLOBAL',
          perfilPermissao: { create: [{ permissaoId: permissao.id }] },
        },
      })
    ).id;
    app = await criarAppTeste();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('CT-02-01: deve criar a sessão e devolver os tokens quando as credenciais estão corretas', async () => {
    const usuario = await criarTutor('ana@exemplo.com', {
      tentativasLoginFalhas: 3,
    });
    const tokens = await entrar('Ana@Exemplo.com');

    expect(tokens).toEqual({
      accessToken: expect.any(String) as string,
      refreshToken: expect.any(String) as string,
      expiraEm: expect.any(String) as string,
    });
    const conteudo = JSON.parse(
      Buffer.from(tokens.accessToken.split('.')[1], 'base64url').toString(),
    ) as Record<string, unknown>;
    expect(conteudo).toMatchObject({
      sub: usuario.id,
      tipo: 'TUTOR',
      // A API também sincroniza o catálogo de permissões no perfil Tutor ao iniciar.
      permissoes: expect.arrayContaining(['pet:ler']) as string[],
    });
    const atualizado = await prisma.usuario.findUniqueOrThrow({
      where: { id: usuario.id },
    });
    expect(atualizado.tentativasLoginFalhas).toBe(0);
    expect(
      await prisma.sessao.count({ where: { usuarioId: usuario.id } }),
    ).toBe(1);
  });

  it('deve responder 401 sem revelar o motivo quando o e-mail não existe', async () => {
    const resposta = await http()
      .post('/v1/auth/login')
      .send({ email: 'ninguem@exemplo.com', senha: SENHA })
      .expect(401);
    expect(resposta.body).toMatchObject({ codigo: 'CREDENCIAIS_INVALIDAS' });
  });

  it('deve responder 422 com os campos inválidos quando o e-mail tem formato errado', async () => {
    const resposta = await http()
      .post('/v1/auth/login')
      .send({ email: 'x', senha: '' })
      .expect(422);
    const corpo = resposta.body as {
      codigo: string;
      campos: { campo: string }[];
    };
    expect(corpo.codigo).toBe('DADOS_INVALIDOS');
    expect(corpo.campos.map((c) => c.campo)).toEqual(
      expect.arrayContaining(['email', 'senha']),
    );
  });

  it('CT-02-02: deve bloquear a conta por 5 minutos quando erra a senha pela quinta vez (RN03)', async () => {
    const usuario = await criarTutor('bruno@exemplo.com');
    const errar = () =>
      http()
        .post('/v1/auth/login')
        .send({ email: 'bruno@exemplo.com', senha: 'errada' });
    for (let i = 1; i <= 4; i++) {
      await errar().expect(401);
    }
    const quinta = await errar().expect(423);
    expect(quinta.body).toMatchObject({ codigo: 'RN03_CONTA_BLOQUEADA' });

    // Mesmo com a senha certa, continua bloqueada até o fim dos 5 minutos.
    await http()
      .post('/v1/auth/login')
      .send({ email: 'bruno@exemplo.com', senha: SENHA })
      .expect(423);

    const bloqueado = await prisma.usuario.findUniqueOrThrow({
      where: { id: usuario.id },
    });
    const minutos = (bloqueado.bloqueadoAte!.getTime() - Date.now()) / 60_000;
    expect(minutos).toBeGreaterThan(4.5);
    expect(minutos).toBeLessThanOrEqual(5);
  });

  it('deve recusar com 403 quando o e-mail ainda não foi confirmado (RN02)', async () => {
    await criarTutor('carla@exemplo.com', {
      emailConfirmado: false,
      status: 'PENDENTE_CONFIRMACAO',
    });
    const resposta = await http()
      .post('/v1/auth/login')
      .send({ email: 'carla@exemplo.com', senha: SENHA })
      .expect(403);
    expect(resposta.body).toMatchObject({
      codigo: 'RN02_EMAIL_NAO_CONFIRMADO',
    });
  });

  it('deve trocar o refresh token quando renova, e o antigo deixa de valer', async () => {
    await criarTutor('davi@exemplo.com');
    const login = await entrar('davi@exemplo.com');
    const renovacao = await http()
      .post('/v1/auth/renovacao')
      .send({ refreshToken: login.refreshToken })
      .expect(200);
    expect((renovacao.body as Tokens).refreshToken).not.toBe(
      login.refreshToken,
    );
    await http()
      .post('/v1/auth/renovacao')
      .send({ refreshToken: login.refreshToken })
      .expect(401);
  });

  it('FA03: deve encerrar a sessão quando fica mais de 4 horas sem atividade (RN04)', async () => {
    const usuario = await criarTutor('elisa@exemplo.com');
    const login = await entrar('elisa@exemplo.com');
    await prisma.sessao.updateMany({
      where: { usuarioId: usuario.id },
      data: { ultimaAtividade: new Date(Date.now() - 4 * 3_600_000 - 60_000) },
    });
    const resposta = await http()
      .post('/v1/auth/renovacao')
      .send({ refreshToken: login.refreshToken })
      .expect(401);
    expect(resposta.body).toMatchObject({ codigo: 'RN04_SESSAO_EXPIRADA' });
    expect(
      await prisma.sessao.count({ where: { usuarioId: usuario.id } }),
    ).toBe(0);
  });

  it('deve revogar a sessão quando faz logout: o access token e o refresh token deixam de valer', async () => {
    await criarTutor('fabio@exemplo.com');
    const login = await entrar('fabio@exemplo.com');
    const autorizacao = `Bearer ${login.accessToken}`;

    await http()
      .post('/v1/auth/logout')
      .set('Authorization', autorizacao)
      .expect(204);
    await http()
      .post('/v1/auth/logout')
      .set('Authorization', autorizacao)
      .expect(401);
    await http()
      .post('/v1/auth/renovacao')
      .send({ refreshToken: login.refreshToken })
      .expect(401);
  });

  it('deve recusar com 401 quando uma rota protegida é chamada sem token', async () => {
    const resposta = await http().post('/v1/auth/logout').expect(401);
    expect(resposta.body).toMatchObject({ codigo: 'NAO_AUTENTICADO' });
  });
});
