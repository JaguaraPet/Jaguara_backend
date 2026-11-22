import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import {
  compartilhar,
  criarEmpresa,
  criarPet,
  criarProfissional,
  criarTutor,
  entrar,
} from './utils/cenario';

interface Alergia {
  id: string;
  descricao: string;
  destaque: boolean;
}

describe('UC-37 · Alergias e restrições do pet (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let tokenAna: string;
  let tokenProfissional: string;
  let petId: string;
  let dipirona: Alergia;

  const http = () => request(app.getHttpServer());
  const como = (t: string, r: request.Test) =>
    r.set('Authorization', `Bearer ${t}`);

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    const anaId = await criarTutor(prisma, 'ana@exemplo.com', 'Ana');
    tokenAna = await entrar(app, 'ana@exemplo.com');
    const clinicaId = await criarEmpresa(app, prisma, 'clinica@exemplo.com');
    await criarProfissional(prisma, clinicaId, 'vet@exemplo.com');
    tokenProfissional = await entrar(app, 'vet@exemplo.com');
    petId = await criarPet(prisma, anaId);
    // A clínica vê as alergias, mas o tutor não liberou a edição clínica.
    await compartilhar(prisma, petId, clinicaId, ['PERFIL_BASICO', 'ALERGIAS']);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('CT-37-01: deve registrar a alergia grave a dipirona e mostrá-la em destaque', async () => {
    await como(
      tokenAna,
      http().post(`/v1/pets/${petId}/alergias`).send({
        tipo: 'RESTRICAO_ALIMENTAR',
        descricao: 'Frango',
        gravidade: 'LEVE',
      }),
    ).expect(201);
    const criada = await como(
      tokenAna,
      http().post(`/v1/pets/${petId}/alergias`).send({
        tipo: 'RESTRICAO_MEDICAMENTOSA',
        descricao: 'Dipirona',
        gravidade: 'GRAVE',
        dataIdentificacao: '2026-10-10',
      }),
    ).expect(201);
    dipirona = criada.body as Alergia;
    expect(dipirona.destaque).toBe(true);
    const lista = await como(
      tokenAna,
      http().get(`/v1/pets/${petId}/alergias`),
    ).expect(200);
    expect((lista.body as Alergia[]).map((a) => a.descricao)).toEqual([
      'Dipirona',
      'Frango',
    ]);
  });

  it('CT-37-02: deve negar a exclusão ao funcionário sem permissão clínica', async () => {
    await como(
      tokenProfissional,
      http().get(`/v1/pets/${petId}/alergias`),
    ).expect(200);
    await como(
      tokenProfissional,
      http().delete(`/v1/alergias/${dipirona.id}`),
    ).expect(403);
    await como(
      tokenAna,
      http()
        .patch(`/v1/alergias/${dipirona.id}`)
        .send({ observacoes: 'Reação forte em 2026' }),
    ).expect(200);
    await como(tokenAna, http().delete(`/v1/alergias/${dipirona.id}`)).expect(
      204,
    );
  });
});
