import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarEmpresa, criarPet, criarTutor, entrar } from './utils/cenario';

interface Evento {
  id: string;
  titulo: string;
  origem: string;
}

describe('UC-10 · Calendário do pet (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let tokenAna: string;
  let petId: string;
  let consulta: Evento;

  // Próximo sábado, 10h em Brasília.
  const sabado = (() => {
    const d = new Date(Date.now() + 2 * 86_400_000);
    while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1);
    return `${d.toISOString().slice(0, 10)}T10:00:00-03:00`;
  })();
  const mais = (iso: string, minutos: number) =>
    new Date(new Date(iso).getTime() + minutos * 60_000).toISOString();

  const http = () => request(app.getHttpServer());
  const como = (r: request.Test) =>
    r.set('Authorization', `Bearer ${tokenAna}`);

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    const anaId = await criarTutor(prisma, 'ana@exemplo.com', 'Ana');
    tokenAna = await entrar(app, 'ana@exemplo.com');
    petId = await criarPet(prisma, anaId);
    const empresaId = await criarEmpresa(app, prisma, 'banho@exemplo.com');
    const servico = await prisma.servico.create({
      data: {
        empresaId,
        nome: 'Banho',
        descricao: 'Banho',
        categoria: 'BANHO_TOSA',
        preco: 60,
        duracaoMinutos: 60,
        ativo: true,
      },
    });
    await prisma.agendamento.create({
      data: {
        servicoId: servico.id,
        petId,
        dataHoraInicio: new Date(mais(sabado, 240)),
        dataHoraFim: new Date(mais(sabado, 300)),
        precoContratado: 60,
        status: 'AGENDADO',
        criadoEm: new Date(),
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('CT-10-01: deve criar a consulta das 10h de sábado e agendar o lembrete', async () => {
    const resposta = await como(
      http().post(`/v1/pets/${petId}/eventos`).send({
        titulo: 'Consulta de rotina',
        tipo: 'CONSULTA',
        dataHoraInicio: sabado,
        local: 'Clínica Patas',
      }),
    ).expect(201);
    consulta = resposta.body as Evento;
    expect(consulta.origem).toBe('MANUAL');
    const lembrete = await prisma.notificacao.findFirstOrThrow({
      where: { origemId: consulta.id },
    });
    expect(lembrete.dataProgramada.toISOString()).toBe(mais(sabado, -60));
  });

  it('CT-10-02: deve impedir outro compromisso no mesmo horário', async () => {
    const resposta = await como(
      http()
        .post(`/v1/pets/${petId}/eventos`)
        .send({
          titulo: 'Passeio no parque',
          tipo: 'COMPROMISSO',
          dataHoraInicio: mais(sabado, 30),
        }),
    ).expect(409);
    expect(resposta.body).toMatchObject({ codigo: 'RN14_CONFLITO_PET' });
    await como(
      http()
        .post(`/v1/pets/${petId}/eventos`)
        .send({
          titulo: 'Passeio',
          tipo: 'COMPROMISSO',
          dataHoraInicio: mais(sabado, 250),
        }),
    ).expect(409);
  });

  it('deve listar eventos e agendamentos juntos e excluir o evento manual', async () => {
    const lista = await como(
      http().get(
        `/v1/pets/${petId}/eventos?de=${encodeURIComponent(mais(sabado, -600))}&ate=${encodeURIComponent(mais(sabado, 600))}`,
      ),
    ).expect(200);
    expect((lista.body as Evento[]).map((e) => [e.titulo, e.origem])).toEqual([
      ['Consulta de rotina', 'MANUAL'],
      ['Banho', 'AGENDAMENTO'],
    ]);
    await como(http().delete(`/v1/eventos/${consulta.id}`)).expect(204);
    const cancelado = await prisma.notificacao.findFirstOrThrow({
      where: { origemId: consulta.id },
    });
    expect(cancelado.status).toBe('CANCELADA');
  });
});
