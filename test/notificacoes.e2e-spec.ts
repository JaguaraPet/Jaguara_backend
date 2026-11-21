import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarPet, criarTutor, entrar } from './utils/cenario';

interface Configuracao {
  tipoEvento: string;
  canal: string;
  antecedenciaMinutos: number;
  ativa: boolean;
}

describe('UC-31 · Preferências e agendamento das notificações (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let token: string;
  let petId: string;

  const http = () => request(app.getHttpServer());
  const como = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const amanha = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    const anaId = await criarTutor(prisma, 'ana@exemplo.com', 'Ana');
    token = await entrar(app, 'ana@exemplo.com');
    petId = await criarPet(prisma, anaId);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('deve mostrar uma configuração padrão por tipo de compromisso', async () => {
    const resposta = await como(
      http().get('/v1/notificacoes/configuracoes'),
    ).expect(200);
    const lista = resposta.body as Configuracao[];
    expect(lista).toHaveLength(9);
    expect(lista).toContainEqual({
      tipoEvento: 'MEDICAMENTO',
      canal: 'PUSH',
      antecedenciaMinutos: 0,
      ativa: true,
    });
  });

  it('CT-31-01: deve avisar a dose das 20h às 19h30 com 30 minutos de antecedência', async () => {
    await como(
      http()
        .put('/v1/notificacoes/configuracoes/MEDICAMENTO')
        .send({ canal: 'PUSH', antecedenciaMinutos: 30, ativa: true }),
    ).expect(200);
    const tratamento = await como(
      http().post(`/v1/pets/${petId}/tratamentos`).send({
        medicamento: 'Amoxicilina',
        dosagem: '1 comprimido',
        viaAdministracao: 'Oral',
        intervaloHoras: 24,
        dataInicio: amanha,
        dataFim: amanha,
        horaPrimeiraDose: '20:00',
      }),
    ).expect(201);
    const lembrete = await prisma.notificacao.findFirstOrThrow({
      where: { origemId: (tratamento.body as { id: string }).id },
    });
    expect(lembrete.dataProgramada.toISOString()).toBe(
      new Date(`${amanha}T19:30:00-03:00`).toISOString(),
    );
    const caixa = await como(http().get('/v1/notificacoes')).expect(200);
    expect(caixa.body).toEqual([
      expect.objectContaining({
        titulo: 'Hora do remédio de Thor',
        status: 'AGENDADA',
      }),
    ]);
  });

  it('não deve agendar quando o tipo está desligado e deve recusar valores inválidos', async () => {
    await como(
      http()
        .put('/v1/notificacoes/configuracoes/CONSULTA')
        .send({ canal: 'EMAIL', antecedenciaMinutos: 60, ativa: false }),
    ).expect(200);
    const evento = await como(
      http()
        .post(`/v1/pets/${petId}/eventos`)
        .send({
          titulo: 'Consulta',
          tipo: 'CONSULTA',
          dataHoraInicio: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        }),
    ).expect(201);
    expect(
      await prisma.notificacao.count({
        where: { origemId: (evento.body as { id: string }).id },
      }),
    ).toBe(0);
    await como(
      http()
        .put('/v1/notificacoes/configuracoes/CONSULTA')
        .send({ canal: 'SMS', antecedenciaMinutos: 60, ativa: true }),
    ).expect(422);
    await como(
      http()
        .put('/v1/notificacoes/configuracoes/INEXISTENTE')
        .send({ canal: 'PUSH', antecedenciaMinutos: 60, ativa: true }),
    ).expect(400);
  });
});
