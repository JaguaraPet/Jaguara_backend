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

describe('UC-36 · Exames do pet (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let tokenAna: string;
  let tokenClinica: string;
  let petId: string;
  let laudoId: string;

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
    await compartilhar(prisma, petId, clinicaId, ['PERFIL_BASICO', 'VACINAS']);
    laudoId = (
      await prisma.documentoPet.create({
        data: {
          petId,
          titulo: 'Laudo do hemograma',
          tipo: 'LAUDO',
          arquivoUrl: 's3://jaguara/pets/laudo.pdf',
          dataUpload: new Date(),
        },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('CT-36-01: deve registrar o hemograma com o laudo e mostrar no histórico', async () => {
    const criado = await como(
      tokenAna,
      http().post(`/v1/pets/${petId}/exames`).send({
        tipoExame: 'Hemograma completo',
        dataRealizacao: '2026-11-10',
        laboratorio: 'Lab Vet',
        resultado: 'Sem alterações',
        documentoId: laudoId,
      }),
    ).expect(201);
    expect(criado.body).toMatchObject({
      tipoExame: 'Hemograma completo',
      documentoId: laudoId,
      temArquivo: true,
    });
    const lista = await como(
      tokenAna,
      http().get(`/v1/pets/${petId}/exames`),
    ).expect(200);
    expect(lista.body).toEqual([
      expect.objectContaining({ tipoExame: 'Hemograma completo' }),
    ]);
    expect(JSON.stringify(lista.body)).not.toContain('s3://');
  });

  it('CT-36-02: deve negar o registro pela empresa sem o escopo de exames', async () => {
    await como(
      tokenClinica,
      http()
        .post(`/v1/pets/${petId}/exames`)
        .send({ tipoExame: 'Raio X', dataRealizacao: '2026-11-11' }),
    ).expect(403);
    await como(tokenClinica, http().get(`/v1/pets/${petId}/exames`)).expect(
      403,
    );
  });

  it('deve recusar data futura e laudo de outro pet', async () => {
    await como(
      tokenAna,
      http()
        .post(`/v1/pets/${petId}/exames`)
        .send({ tipoExame: 'Raio X', dataRealizacao: '2099-01-01' }),
    ).expect(422);
    await como(
      tokenAna,
      http().post(`/v1/pets/${petId}/exames`).send({
        tipoExame: 'Raio X',
        dataRealizacao: '2026-11-11',
        documentoId: '00000000-0000-4000-8000-000000000000',
      }),
    ).expect(422);
  });
});
