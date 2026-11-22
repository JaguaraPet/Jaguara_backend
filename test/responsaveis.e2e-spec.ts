import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarPet, criarTutor, entrar } from './utils/cenario';

interface Responsavel {
  tutorId: string;
  tipo: string;
}

describe('UC-05 · Responsáveis pelo pet (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let anaId: string;
  let caioId: string;
  let tokenAna: string;
  let tokenCaio: string;
  let petId: string;

  const http = () => request(app.getHttpServer());
  const como = (t: string, r: request.Test) =>
    r.set('Authorization', `Bearer ${t}`);

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    anaId = await criarTutor(prisma, 'ana@exemplo.com', 'Ana');
    tokenAna = await entrar(app, 'ana@exemplo.com');
    caioId = await criarTutor(prisma, 'caio@exemplo.com', 'Caio');
    tokenCaio = await entrar(app, 'caio@exemplo.com');
    petId = await criarPet(prisma, anaId);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('CT-05-01: deve vincular outro tutor como adicional e liberar o pet para ele', async () => {
    await como(tokenCaio, http().get(`/v1/pets/${petId}`)).expect(403);
    const resposta = await como(
      tokenAna,
      http()
        .post(`/v1/pets/${petId}/responsaveis`)
        .send({ email: 'Caio@Exemplo.com', tipo: 'ADICIONAL' }),
    ).expect(201);
    expect(resposta.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tutorId: caioId, tipo: 'ADICIONAL' }),
      ]),
    );
    await como(tokenCaio, http().get(`/v1/pets/${petId}`)).expect(200);
    await como(
      tokenAna,
      http()
        .post(`/v1/pets/${petId}/responsaveis`)
        .send({ email: 'caio@exemplo.com', tipo: 'ADICIONAL' }),
    ).expect(409);
    await como(
      tokenAna,
      http()
        .post(`/v1/pets/${petId}/responsaveis`)
        .send({ email: 'ninguem@exemplo.com', tipo: 'ADICIONAL' }),
    ).expect(404);
  });

  it('CT-05-02: deve impedir que o único principal remova o próprio vínculo', async () => {
    const resposta = await como(
      tokenAna,
      http().delete(`/v1/pets/${petId}/responsaveis/${anaId}`),
    ).expect(409);
    expect(resposta.body).toMatchObject({ codigo: 'RN09_SEM_PRINCIPAL' });
    // O adicional não remove o principal, mas pode sair.
    await como(
      tokenCaio,
      http().delete(`/v1/pets/${petId}/responsaveis/${anaId}`),
    ).expect(403);
  });

  it('deve permitir trocar o principal e depois o antigo sair', async () => {
    await como(
      tokenAna,
      http()
        .patch(`/v1/pets/${petId}/responsaveis/${caioId}`)
        .send({ tipo: 'PRINCIPAL' }),
    ).expect(200);
    await como(
      tokenAna,
      http().delete(`/v1/pets/${petId}/responsaveis/${anaId}`),
    ).expect(204);
    const lista = await como(
      tokenCaio,
      http().get(`/v1/pets/${petId}/responsaveis`),
    ).expect(200);
    expect((lista.body as Responsavel[]).map((r) => r.tutorId)).toEqual([
      caioId,
    ]);
    await como(tokenAna, http().get(`/v1/pets/${petId}`)).expect(403);
  });
});
