import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { FILA_WEBHOOKS } from '../src/compartilhado/webhooks/webhook';
import { PublicadorWebhook } from '../src/compartilhado/webhooks/publicador-webhook';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarAdministrador, entrar } from './utils/cenario';

interface Webhook {
  id: string;
  ativo: boolean;
  segredo?: string;
}

describe('UC-27 e UC-30 · Integrações e webhooks de saída (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let token: string;
  let tokenSemPermissao: string;
  let webhook: Webhook;

  const http = () => request(app.getHttpServer());
  const como = (r: request.Test, t = token) =>
    r.set('Authorization', `Bearer ${t}`);

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    await criarAdministrador(prisma, 'admin@exemplo.com');
    token = await entrar(app, 'admin@exemplo.com');
    await criarAdministrador(prisma, 'suporte@exemplo.com', ['admin:suporte']);
    tokenSemPermissao = await entrar(app, 'suporte@exemplo.com');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('CT-27-01: deve salvar a integração com as credenciais cifradas', async () => {
    const criada = await como(
      http().post('/v1/admin/integracoes').send({
        nome: 'Google Agenda',
        tipo: 'CALENDARIO',
        endpointUrl: 'https://www.googleapis.com/calendar/v3',
        credenciais: 'token-secreto-do-provedor',
      }),
    ).expect(201);
    expect(criada.body).toMatchObject({ ativa: true, temCredenciais: true });
    expect(JSON.stringify(criada.body)).not.toContain('token-secreto');
    const gravada = await prisma.integracao.findFirstOrThrow();
    expect(gravada.credenciaisCifradas).not.toContain('token-secreto');
    const lista = await como(http().get('/v1/admin/integracoes')).expect(200);
    expect(lista.body).toHaveLength(1);
  });

  it('CT-27-02: deve bloquear o administrador sem permissão de integrações', async () => {
    await como(
      http().post('/v1/admin/integracoes').send({
        nome: 'Outra',
        tipo: 'OUTRA',
        endpointUrl: 'https://exemplo.com',
        credenciais: 'x',
      }),
      tokenSemPermissao,
    ).expect(403);
  });

  it('CT-30-01: deve salvar o webhook HTTPS com segredo de assinatura', async () => {
    const criado = await como(
      http()
        .post('/v1/admin/webhooks')
        .send({
          url: 'https://parceiro.exemplo.com/jaguara',
          eventos: ['agendamento.criado', 'pagamento.confirmado'],
          metodoAutenticacao: 'HMAC_SHA256',
        }),
    ).expect(201);
    webhook = criado.body as Webhook;
    expect(webhook.segredo).toMatch(/^[\w-]{43}$/);
    const lista = await como(http().get('/v1/admin/webhooks')).expect(200);
    expect(JSON.stringify(lista.body)).not.toContain(webhook.segredo!);
  });

  it('CT-30-02: deve bloquear a URL HTTP sem autenticação e dizer o motivo', async () => {
    const resposta = await como(
      http()
        .post('/v1/admin/webhooks')
        .send({
          url: 'http://parceiro.exemplo.com/jaguara',
          eventos: ['agendamento.criado'],
          metodoAutenticacao: 'NENHUMA',
        }),
    ).expect(422);
    expect(JSON.stringify(resposta.body)).toContain('HTTPS');
    await como(
      http()
        .post('/v1/admin/webhooks')
        .send({
          url: 'https://localhost/jaguara',
          eventos: ['agendamento.criado'],
          metodoAutenticacao: 'HMAC_SHA256',
        }),
    ).expect(422);
  });

  it('deve publicar o evento só para webhooks ativos que o assinam', async () => {
    const fila = app.get<Queue>(getQueueToken(FILA_WEBHOOKS));
    await fila.obliterate({ force: true });
    const publicador = app.get(PublicadorWebhook);
    await publicador.publicar('agendamento.criado', { agendamentoId: 'a1' });
    await publicador.publicar('solicitacao.criada', { solicitacaoId: 's1' });
    let jobs = await fila.getJobs(['waiting', 'delayed', 'active']);
    expect(jobs.map((j) => j.name)).toEqual(['agendamento.criado']);
    expect(jobs[0].opts.attempts).toBe(5);

    await como(
      http().patch(`/v1/admin/webhooks/${webhook.id}`).send({ ativo: false }),
    ).expect(200);
    await fila.obliterate({ force: true });
    await publicador.publicar('agendamento.criado', { agendamentoId: 'a2' });
    jobs = await fila.getJobs(['waiting', 'delayed', 'active']);
    expect(jobs).toHaveLength(0);
  });
});
