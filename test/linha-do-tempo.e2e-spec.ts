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
  criarTutor,
  entrar,
} from './utils/cenario';

interface Item {
  tipo: string;
  titulo: string;
}

describe('UC-35 · Linha do tempo do pet (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let tokenAna: string;
  let tokenClinica: string;
  let petId: string;

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
    tokenClinica = await entrar(app, 'clinica@exemplo.com');
    petId = await criarPet(prisma, anaId);
    // A clínica vê vacinas, mas não a linha do tempo.
    await compartilhar(prisma, petId, clinicaId, ['PERFIL_BASICO', 'VACINAS']);
    const vacinar = (nome: string, data: string) =>
      como(
        tokenAna,
        http().post(`/v1/pets/${petId}/vacinacoes`).send({
          nomeVacina: nome,
          dataAplicacao: data,
          responsavelAplicacao: 'Dra. Júlia',
        }),
      ).expect(201);
    await vacinar('V10', '2026-09-01');
    await como(
      tokenAna,
      http()
        .post(`/v1/pets/${petId}/exames`)
        .send({ tipoExame: 'Hemograma', dataRealizacao: '2026-08-15' }),
    ).expect(201);
    await vacinar('Antirrábica', '2026-10-01');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('CT-35-01: deve mostrar vacinas e exames em ordem cronológica', async () => {
    const resposta = await como(
      tokenAna,
      http().get(`/v1/pets/${petId}/linha-do-tempo`),
    ).expect(200);
    expect((resposta.body as Item[]).map((i) => i.titulo)).toEqual([
      'Exame: Hemograma',
      'Vacina V10',
      'Vacina Antirrábica',
    ]);
  });

  it('CT-35-02: deve negar a linha do tempo à empresa sem o escopo', async () => {
    await como(
      tokenClinica,
      http().get(`/v1/pets/${petId}/linha-do-tempo`),
    ).expect(403);
  });
});
