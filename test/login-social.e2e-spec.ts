import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { VerificadorIdentidade } from '../src/modulos/acesso/infra/verificador-identidade';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { cpfTeste, criarTutor, SENHA_TESTE } from './utils/cenario';

/** Claims que o Google mandaria; a assinatura é conferida no teste de unidade do verificador. */
const google = (sub: string, email: string, nonce = 'n-1') => ({
  iss: 'https://accounts.google.com',
  aud: 'cliente-teste.apps.googleusercontent.com',
  sub,
  exp: Math.floor(Date.now() / 1000) + 600,
  email,
  email_verified: true,
  nonce,
  name: 'Bia Nunes',
});

describe('UC-02 FA04 · Login com Google e Apple (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  const tokens = new Map<string, object>();

  const http = () => request(app.getHttpServer());
  const entrarSocial = (idToken: string, extra: object = {}) =>
    http()
      .post('/v1/auth/login/social')
      .send({ provedor: 'GOOGLE', idToken, nonce: 'n-1', ...extra });

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    jest
      .spyOn(app.get(VerificadorIdentidade), 'verificar')
      .mockImplementation((_provedor, idToken) =>
        Promise.resolve(tokens.get(idToken) ?? null),
      );
    for (const tipo of ['TERMOS_USO_APP', 'POLITICA_PRIVACIDADE'] as const) {
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
    await criarTutor(prisma, 'ana@exemplo.com', 'Ana');
    tokens.set('token-ana', google('g-ana', 'ana@exemplo.com'));
    tokens.set('token-bia', google('g-bia', 'bia@gmail.com'));
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('deve recusar token que o provedor não assinou', async () => {
    await entrarSocial('token-falso').expect(401);
  });

  it('CT-02-04: deve pedir a senha da conta com o mesmo e-mail e ligar a identidade depois dela', async () => {
    const pedido = await entrarSocial('token-ana').expect(409);
    expect(pedido.body).toMatchObject({ codigo: 'IDENTIDADE_SEM_VINCULO' });
    await entrarSocial('token-ana', { senha: 'SenhaErrada1' }).expect(409);
    const ligado = await entrarSocial('token-ana', {
      senha: SENHA_TESTE,
    }).expect(200);
    expect(ligado.body).toHaveProperty('accessToken');
    expect(
      await prisma.identidadeExterna.count({ where: { idExterno: 'g-ana' } }),
    ).toBe(1);
  });

  it('CT-02-03: com a identidade já ligada, deve entrar direto', async () => {
    const sessao = await entrarSocial('token-ana').expect(200);
    expect(sessao.body).toHaveProperty('refreshToken');
  });

  it('UC-01: no primeiro acesso deve concluir o cadastro com CPF e aceite e já entrar', async () => {
    const pendente = await entrarSocial('token-bia').expect(428);
    const { cadastroToken, nome, email } = pendente.body as {
      cadastroToken: string;
      nome: string;
      email: string;
    };
    expect({ nome, email }).toEqual({
      nome: 'Bia Nunes',
      email: 'bia@gmail.com',
    });

    await http()
      .post('/v1/auth/cadastro/social')
      .send({
        cadastroToken,
        nome: 'Bia Nunes',
        cpf: cpfTeste(),
        aceiteTermos: false,
      })
      .expect(422);
    const criado = await http()
      .post('/v1/auth/cadastro/social')
      .send({
        cadastroToken,
        nome: 'Bia Nunes',
        cpf: cpfTeste(),
        aceiteTermos: true,
      })
      .expect(201);
    expect(criado.body).toHaveProperty('accessToken');
    const conta = await prisma.usuario.findUniqueOrThrow({
      where: { email: 'bia@gmail.com' },
      include: { consentimento: true },
    });
    expect(conta).toMatchObject({
      status: 'ATIVA',
      emailConfirmado: true,
      senhaHash: null,
    });
    expect(conta.consentimento).toHaveLength(2);
    await entrarSocial('token-bia').expect(200);
  });

  it('deve recusar o token de cadastro inválido', async () => {
    await http()
      .post('/v1/auth/cadastro/social')
      .send({
        cadastroToken: 'invalido',
        nome: 'X',
        cpf: cpfTeste(),
        aceiteTermos: true,
      })
      .expect(410);
  });
});
