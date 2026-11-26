import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { FilaEmailService } from '../src/modulos/notificacao/aplicacao/fila-email.service';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarAdministrador, criarTutor, entrar } from './utils/cenario';

interface Detalhe {
  id: string;
  protocolo: string;
  status: string;
  descricao: string;
  solicitante: { nome: string };
  intervencoes: { acaoExecutada: string; autor: string }[];
}

describe('UC-26 · Chamados de suporte (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let tokenAdmin: string;
  let tokenAna: string;
  let chamadoId: string;
  const emails: { tipo: string; para: string }[] = [];

  const http = () => request(app.getHttpServer());
  const como = (t: string, r: request.Test) =>
    r.set('Authorization', `Bearer ${t}`);

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    jest
      .spyOn(app.get(FilaEmailService), 'enviar')
      .mockImplementation((tipo, para) => {
        emails.push({ tipo, para });
        return Promise.resolve();
      });
    await criarAdministrador(prisma, 'admin@exemplo.com');
    tokenAdmin = await entrar(app, 'admin@exemplo.com');
    await criarTutor(prisma, 'ana@exemplo.com', 'Ana');
    tokenAna = await entrar(app, 'ana@exemplo.com');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('deve abrir o chamado pelo usuário e listar na central do suporte', async () => {
    const aberto = await como(
      tokenAna,
      http().post('/v1/chamados').send({
        titulo: 'Vacina não anexa',
        descricao: 'O app fecha quando escolho a foto da carteirinha.',
      }),
    ).expect(201);
    chamadoId = (aberto.body as Detalhe).id;
    expect((aberto.body as Detalhe).protocolo).toMatch(/^SUP-\d{8}-/);
    const lista = await como(
      tokenAdmin,
      http().get('/v1/admin/chamados?status=ABERTO'),
    ).expect(200);
    expect((lista.body as Detalhe[])[0]?.solicitante.nome).toBe('Ana');
    await como(tokenAna, http().get('/v1/admin/chamados')).expect(403);
  });

  it('CT-26-02: deve pedir informação, avisar e aceitar o complemento', async () => {
    const pedido = await como(
      tokenAdmin,
      http()
        .post(`/v1/admin/chamados/${chamadoId}/pedido-informacao`)
        .send({ mensagem: 'Qual é o modelo do celular?' }),
    ).expect(201);
    expect((pedido.body as Detalhe).status).toBe('AGUARDANDO_INFORMACAO');
    expect(emails).toContainEqual({
      tipo: 'NOTIFICACAO',
      para: 'ana@exemplo.com',
    });
    const resposta = await como(
      tokenAna,
      http()
        .post(`/v1/chamados/${chamadoId}/complemento`)
        .send({ mensagem: 'Uso um Moto G com Android 14.' }),
    ).expect(201);
    expect(resposta.body).toMatchObject({ status: 'EM_ANALISE' });
  });

  it('CT-26-01: deve registrar a intervenção no chamado e na auditoria', async () => {
    const final = await como(
      tokenAdmin,
      http().post(`/v1/admin/chamados/${chamadoId}/intervencoes`).send({
        acaoExecutada: 'Liberei o tipo de arquivo',
        descricao: 'Ajustei o limite e a foto entrou.',
        status: 'RESOLVIDO',
      }),
    ).expect(201);
    const detalhe = final.body as Detalhe;
    expect(detalhe.status).toBe('RESOLVIDO');
    expect(detalhe.descricao).toContain('Moto G');
    expect(detalhe.intervencoes.map((i) => i.acaoExecutada)).toEqual([
      'Pedido de informação',
      'Liberei o tipo de arquivo',
    ]);
    const auditoria = await prisma.logAuditoria.findMany({
      where: { entidade: 'ChamadoSuporte', entidadeId: chamadoId },
    });
    expect(auditoria).toHaveLength(2);
    const meus = await como(tokenAna, http().get('/v1/chamados')).expect(200);
    expect((meus.body as Detalhe[])[0]?.status).toBe('RESOLVIDO');
  });

  it('deve exigir a descrição da intervenção', async () => {
    await como(
      tokenAdmin,
      http()
        .post(`/v1/admin/chamados/${chamadoId}/intervencoes`)
        .send({ acaoExecutada: 'X', descricao: '', status: 'FECHADO' }),
    ).expect(422);
  });
});
