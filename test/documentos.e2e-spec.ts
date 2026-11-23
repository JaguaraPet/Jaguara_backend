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

interface Documento {
  id: string;
  titulo: string;
  nomeArquivo: string;
}

describe('UC-34 · Documentos do pet (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let tokenAna: string;
  let tokenBia: string;
  let tokenClinica: string;
  let petId: string;
  let documentoId: string;

  const http = () => request(app.getHttpServer());
  const como = (t: string, r: request.Test) =>
    r.set('Authorization', `Bearer ${t}`);

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    const anaId = await criarTutor(prisma, 'ana@exemplo.com', 'Ana');
    tokenAna = await entrar(app, 'ana@exemplo.com');
    await criarTutor(prisma, 'bia@exemplo.com', 'Bia');
    tokenBia = await entrar(app, 'bia@exemplo.com');
    const clinicaId = await criarEmpresa(app, prisma, 'clinica@exemplo.com');
    await criarProfissional(prisma, clinicaId, 'vet@exemplo.com');
    tokenClinica = await entrar(app, 'vet@exemplo.com');
    petId = await criarPet(prisma, anaId);
    // A clínica recebeu as vacinas, mas não os documentos.
    await compartilhar(prisma, petId, clinicaId, ['PERFIL_BASICO', 'VACINAS']);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('CT-34-01: deve registrar o laudo e devolver a URL de envio assinada', async () => {
    const resposta = await como(
      tokenAna,
      http().post(`/v1/pets/${petId}/documentos`).send({
        titulo: 'Hemograma',
        tipo: 'LAUDO',
        nomeArquivo: 'hemograma março.pdf',
        tamanhoBytes: 120_000,
      }),
    ).expect(201);
    const corpo = resposta.body as { documentoId: string; urlEnvio: string };
    documentoId = corpo.documentoId;
    expect(corpo.urlEnvio).toContain(
      `/pets/${petId}/documentos/${documentoId}/hemograma_marco.pdf?`,
    );
    expect(corpo.urlEnvio).toContain('X-Amz-Signature=');

    const lista = await como(
      tokenAna,
      http().get(`/v1/pets/${petId}/documentos`),
    ).expect(200);
    expect(lista.body as Documento[]).toEqual([
      expect.objectContaining({
        id: documentoId,
        titulo: 'Hemograma',
        nomeArquivo: 'hemograma_marco.pdf',
      }),
    ]);
    const download = await como(
      tokenAna,
      http().get(`/v1/documentos/${documentoId}/download`),
    ).expect(200);
    expect((download.body as { url: string }).url).toContain(
      'response-content-disposition=attachment',
    );
  });

  it('deve recusar arquivo de formato não aceito', async () => {
    const resposta = await como(
      tokenAna,
      http().post(`/v1/pets/${petId}/documentos`).send({
        titulo: 'Programa',
        tipo: 'OUTRO',
        nomeArquivo: 'instalar.exe',
        tamanhoBytes: 500,
      }),
    ).expect(422);
    expect(JSON.stringify(resposta.body)).toContain('PDF ou imagem');
  });

  it('CT-34-02: deve negar o documento a quem não tem o escopo DOCUMENTOS', async () => {
    await como(
      tokenClinica,
      http().get(`/v1/documentos/${documentoId}/download`),
    ).expect(403);
    await como(tokenClinica, http().get(`/v1/pets/${petId}/documentos`)).expect(
      403,
    );
    await como(
      tokenBia,
      http().get(`/v1/documentos/${documentoId}/download`),
    ).expect(404);
  });

  it('deve excluir o documento', async () => {
    await como(tokenAna, http().delete(`/v1/documentos/${documentoId}`)).expect(
      204,
    );
    const lista = await como(
      tokenAna,
      http().get(`/v1/pets/${petId}/documentos`),
    ).expect(200);
    expect(lista.body).toEqual([]);
  });
});
