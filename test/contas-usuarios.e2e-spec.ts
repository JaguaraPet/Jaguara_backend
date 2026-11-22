import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import {
  SENHA_TESTE,
  criarAdministrador,
  criarTutor,
  entrar,
} from './utils/cenario';

interface Conta {
  id: string;
  nome: string;
  status: string;
  historico: { acao: string; motivo?: string }[];
}

describe('UC-28 · Gestão de contas de usuários (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let tokenAdmin: string;
  let tokenAna: string;
  let adminId: string;
  let anaId: string;

  const http = () => request(app.getHttpServer());
  const como = (t: string, r: request.Test) =>
    r.set('Authorization', `Bearer ${t}`);

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    adminId = await criarAdministrador(prisma, 'admin@exemplo.com');
    tokenAdmin = await entrar(app, 'admin@exemplo.com');
    anaId = await criarTutor(prisma, 'ana@exemplo.com', 'Ana');
    tokenAna = await entrar(app, 'ana@exemplo.com');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('deve buscar a conta pelo nome e negar quem não é administrador', async () => {
    const lista = await como(
      tokenAdmin,
      http().get('/v1/admin/usuarios?busca=ana'),
    ).expect(200);
    expect((lista.body as Conta[]).map((c) => c.nome)).toEqual(['Ana']);
    await como(tokenAna, http().get('/v1/admin/usuarios')).expect(403);
  });

  it('CT-28-01: deve suspender a conta com motivo e auditar', async () => {
    await como(
      tokenAdmin,
      http()
        .put(`/v1/admin/usuarios/${anaId}/status`)
        .send({ status: 'SUSPENSA', motivo: 'Denúncia de spam no chat' }),
    ).expect(204);
    const detalhe = await como(
      tokenAdmin,
      http().get(`/v1/admin/usuarios/${anaId}`),
    ).expect(200);
    expect(detalhe.body).toMatchObject({
      status: 'SUSPENSA',
      sessoesAtivas: 0,
      historico: [
        { acao: 'CONTA_SUSPENSA', motivo: 'Denúncia de spam no chat' },
      ],
    });
    await http()
      .post('/v1/auth/login')
      .send({ email: 'ana@exemplo.com', senha: SENHA_TESTE })
      .expect(403);
  });

  it('deve reativar a conta e recusar mudança inválida', async () => {
    await como(
      tokenAdmin,
      http()
        .put(`/v1/admin/usuarios/${anaId}/status`)
        .send({ status: 'ATIVA', motivo: 'Denúncia não confirmada' }),
    ).expect(204);
    const repetida = await como(
      tokenAdmin,
      http()
        .put(`/v1/admin/usuarios/${anaId}/status`)
        .send({ status: 'ATIVA', motivo: 'De novo' }),
    ).expect(409);
    expect(repetida.body).toMatchObject({ codigo: 'RN34_STATUS_INVALIDO' });
    await como(
      tokenAdmin,
      http()
        .put(`/v1/admin/usuarios/${adminId}/status`)
        .send({ status: 'BLOQUEADA', motivo: 'Teste da própria conta' }),
    ).expect(409);
    await como(
      tokenAdmin,
      http()
        .put(`/v1/admin/usuarios/${anaId}/status`)
        .send({ status: 'SUSPENSA' }),
    ).expect(422);
  });
});
