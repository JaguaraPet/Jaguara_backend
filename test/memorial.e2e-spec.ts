import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarPet, criarTutor, entrar } from './utils/cenario';

interface Memorial {
  mensagem?: string;
  itens: { tipo: string; conteudo?: string; urlFoto?: string }[];
}

describe('UC-15 · Memorial do pet (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let tokenAna: string;
  let tokenBia: string;
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
    await criarTutor(prisma, 'bia@exemplo.com', 'Bia');
    tokenBia = await entrar(app, 'bia@exemplo.com');
    petId = await criarPet(prisma, anaId, 'Thor');
    const tratamento = await prisma.registroClinico.create({
      data: {
        petId,
        registradoPorId: anaId,
        dataRegistro: new Date(),
        valido: true,
        tratamentoMedicamentoso: {
          create: {
            medicamento: 'Vermífugo',
            dosagem: '1 comprimido',
            viaAdministracao: 'Oral',
            intervaloHoras: 24,
            dataInicio: new Date(),
            status: 'ATIVO',
          },
        },
      },
      include: { tratamentoMedicamentoso: true },
    });
    await prisma.notificacao.create({
      data: {
        titulo: 'Hora do remédio',
        mensagem: 'Vermífugo',
        canal: 'PUSH',
        dataProgramada: new Date(Date.now() + 86_400_000),
        status: 'AGENDADA',
        tentativas: 0,
        destinatarioId: anaId,
        origemTipo: 'TRATAMENTO',
        origemId: tratamento.tratamentoMedicamentoso!.id,
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('CT-15-02: deve bloquear o memorial de pet ativo', async () => {
    const r = await como(
      tokenAna,
      http()
        .put(`/v1/pets/${petId}/memorial`)
        .send({ mensagem: 'Saudade', publico: false }),
    ).expect(409);
    expect(r.body).toMatchObject({ codigo: 'RN19_MEMORIAL_BLOQUEADO' });
  });

  it('deve registrar o falecimento, finalizar remédios e cancelar lembretes', async () => {
    await como(tokenBia, http().post(`/v1/pets/${petId}/falecimento`)).expect(
      404,
    );
    await como(tokenAna, http().post(`/v1/pets/${petId}/falecimento`)).expect(
      204,
    );
    const pet = await prisma.pet.findUniqueOrThrow({ where: { id: petId } });
    expect(pet.status).toBe('FALECIDO');
    expect(
      await prisma.tratamentoMedicamentoso.count({
        where: { status: 'ATIVO' },
      }),
    ).toBe(0);
    expect(
      await prisma.notificacao.count({ where: { status: 'AGENDADA' } }),
    ).toBe(0);
  });

  it('CT-15-01: deve criar o memorial com texto e foto e mostrá-lo', async () => {
    await como(
      tokenAna,
      http()
        .put(`/v1/pets/${petId}/memorial`)
        .send({ mensagem: 'Para sempre no nosso coração', publico: false }),
    ).expect(200);
    await como(
      tokenAna,
      http()
        .post(`/v1/pets/${petId}/memorial/itens`)
        .send({ tipo: 'TEXTO', conteudo: 'Adorava correr na praia.' }),
    ).expect(201);
    const foto = await como(
      tokenAna,
      http().post(`/v1/pets/${petId}/memorial/itens`).send({
        tipo: 'FOTO',
        nomeArquivo: 'thor na praia.jpg',
        tamanhoBytes: 300_000,
      }),
    ).expect(201);
    expect((foto.body as { urlEnvio: string }).urlEnvio).toContain(
      'X-Amz-Signature=',
    );
    await como(
      tokenAna,
      http().post(`/v1/pets/${petId}/memorial/itens`).send({
        tipo: 'FOTO',
        nomeArquivo: 'video.mp4',
        tamanhoBytes: 300_000,
      }),
    ).expect(422);

    const memorial = await como(
      tokenAna,
      http().get(`/v1/pets/${petId}/memorial`),
    ).expect(200);
    const corpo = memorial.body as Memorial;
    expect(corpo.mensagem).toBe('Para sempre no nosso coração');
    expect(corpo.itens.map((i) => i.tipo)).toEqual(['TEXTO', 'FOTO']);
    expect(corpo.itens[1].urlFoto).toContain('thor_na_praia.jpg');
    await como(tokenBia, http().get(`/v1/pets/${petId}/memorial`)).expect(404);
  });
});
