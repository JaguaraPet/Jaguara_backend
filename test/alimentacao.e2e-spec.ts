import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarPet, criarTutor, entrar } from './utils/cenario';

describe('UC-08 · Alimentação do pet (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let token: string;
  let petId: string;

  const http = () => request(app.getHttpServer());
  const como = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const minutosAtras = (m: number) =>
    new Date(Date.now() - m * 60_000).toISOString();

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

  it('deve definir o plano com meta e limite diários (RN12)', async () => {
    const plano = await como(
      http().put(`/v1/pets/${petId}/plano-alimentar`).send({
        alimento: 'Ração adulto',
        metaDiariaGramas: 250,
        limiteDiarioGramas: 300,
        refeicoesPorDia: 2,
      }),
    ).expect(200);
    expect(plano.body).toMatchObject({ limiteDiarioGramas: 300 });
    await como(
      http().put(`/v1/pets/${petId}/plano-alimentar`).send({
        alimento: 'Ração',
        metaDiariaGramas: 250,
        limiteDiarioGramas: 100,
        refeicoesPorDia: 2,
      }),
    ).expect(422);
  });

  it('CT-08-01: deve registrar 200 g e mostrar o consumo do dia', async () => {
    // Bem perto da hora atual, para cair no mesmo dia de Brasília.
    const resposta = await como(
      http()
        .post(`/v1/pets/${petId}/refeicoes`)
        .send({
          dataHora: minutosAtras(2),
          alimento: 'Ração adulto',
          quantidadeGramas: 200,
        }),
    ).expect(201);
    expect(resposta.body).toMatchObject({
      consumoDoDia: 200,
      limiteExcedido: false,
    });
  });

  it('CT-08-02: deve registrar e alertar quando passa do limite', async () => {
    await como(
      http()
        .post(`/v1/pets/${petId}/refeicoes`)
        .send({
          dataHora: minutosAtras(1),
          alimento: 'Petisco',
          quantidadeGramas: 50,
        }),
    ).expect(201);
    const resposta = await como(
      http()
        .post(`/v1/pets/${petId}/refeicoes`)
        .send({
          dataHora: minutosAtras(0),
          alimento: 'Ração adulto',
          quantidadeGramas: 100,
        }),
    ).expect(201);
    expect(resposta.body).toMatchObject({
      consumoDoDia: 350,
      limiteExcedido: true,
    });
    const dia = await como(http().get(`/v1/pets/${petId}/refeicoes`)).expect(
      200,
    );
    expect(dia.body).toMatchObject({ consumoDoDia: 350, limiteExcedido: true });
    expect((dia.body as { refeicoes: unknown[] }).refeicoes).toHaveLength(3);
  });

  it('deve recusar refeição no futuro', async () => {
    await como(
      http()
        .post(`/v1/pets/${petId}/refeicoes`)
        .send({
          dataHora: new Date(Date.now() + 3_600_000).toISOString(),
          alimento: 'Ração',
          quantidadeGramas: 10,
        }),
    ).expect(422);
  });
});
