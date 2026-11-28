import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { hojeBrasilia } from '../src/modulos/notificacao/dominio/lembretes';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarPet, criarTutor, entrar } from './utils/cenario';

interface Hoje {
  pets: {
    id: string;
    itens: {
      tipo: string;
      id: string;
      horario: string | null;
      previstaPara: string | null;
      feito: boolean;
      feitoPor: string | null;
    }[];
  }[];
}

describe('Criador de rotinas e tela Hoje do tutor (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let tokenAna: string;
  let tokenBia: string;
  let petId: string;
  let rotinaId: string;

  const http = () => request(app.getHttpServer());
  const como = (token: string, r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    const ana = await criarTutor(prisma, 'ana@exemplo.com', 'Ana Ribeiro');
    tokenAna = await entrar(app, 'ana@exemplo.com');
    await criarTutor(prisma, 'bia@exemplo.com', 'Bia');
    tokenBia = await entrar(app, 'bia@exemplo.com');
    petId = await criarPet(prisma, ana);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('deve oferecer os modelos prontos, sem recomendação veterinária', async () => {
    const modelos = await como(
      tokenAna,
      http().get('/v1/rotinas/modelos'),
    ).expect(200);
    expect((modelos.body as { tipo: string }[]).map((m) => m.tipo)).toContain(
      'PASSEIO',
    );
  });

  it('deve criar a rotina, programar os lembretes e recusar regra incompleta', async () => {
    await como(tokenAna, http().post(`/v1/pets/${petId}/rotinas`))
      .send({ titulo: 'Escovar', tipo: 'ESCOVACAO', frequencia: 'SEMANAL' })
      .expect(422);
    const criada = await como(
      tokenAna,
      http().post(`/v1/pets/${petId}/rotinas`),
    )
      .send({
        titulo: 'Passeio',
        tipo: 'PASSEIO',
        frequencia: 'DIARIA',
        horarios: ['23:59', '07:00'],
      })
      .expect(201);
    rotinaId = (criada.body as { id: string }).id;
    expect(criada.body).toMatchObject({
      horarios: ['07:00', '23:59'],
      dataInicio: hojeBrasilia(),
    });
    const lembretes = await prisma.notificacao.count({
      where: { origemTipo: 'ROTINA', origemId: rotinaId },
    });
    expect(lembretes).toBeGreaterThan(0);
  });

  it('deve negar a rotina do pet a quem não é responsável', async () => {
    await como(tokenBia, http().get(`/v1/pets/${petId}/rotinas`)).expect(404);
  });

  it('deve mostrar a rotina no dia e quem marcou como feito', async () => {
    await como(tokenAna, http().post(`/v1/rotinas/${rotinaId}/feitos`))
      .send({ horario: '07:00' })
      .expect(201);
    const hoje = await como(tokenAna, http().get('/v1/tutor/hoje')).expect(200);
    const itens = (hoje.body as Hoje).pets[0].itens.filter(
      (i) => i.id === rotinaId,
    );
    expect(itens).toEqual([
      expect.objectContaining({
        horario: '07:00',
        feito: true,
        feitoPor: 'Ana',
      }),
      expect.objectContaining({ horario: '23:59', feito: false }),
    ]);
  });

  it('deve registrar a dose do remédio de hoje e mostrar quem deu', async () => {
    const hoje = hojeBrasilia();
    const registro = await prisma.registroClinico.create({
      data: {
        petId,
        registradoPorId: (
          await prisma.usuario.findFirstOrThrow({
            where: { email: 'ana@exemplo.com' },
          })
        ).id,
        dataRegistro: new Date(),
        valido: true,
        tratamentoMedicamentoso: {
          create: {
            medicamento: 'Amoxicilina',
            dosagem: '1 comprimido',
            viaAdministracao: 'Oral',
            intervaloHoras: 12,
            horaPrimeiraDose: '00:30',
            dataInicio: new Date(hoje),
            status: 'ATIVO',
          },
        },
      },
    });
    const antes = await como(tokenAna, http().get('/v1/tutor/hoje')).expect(
      200,
    );
    const doses = (antes.body as Hoje).pets[0].itens.filter(
      (i) => i.tipo === 'REMEDIO',
    );
    expect(doses.map((d) => d.horario)).toEqual(['00:30', '12:30']);

    await como(tokenAna, http().post(`/v1/tratamentos/${registro.id}/doses`))
      .send({ previstaPara: doses[0].previstaPara })
      .expect(201);
    const depois = await como(tokenAna, http().get('/v1/tutor/hoje')).expect(
      200,
    );
    const dada = (depois.body as Hoje).pets[0].itens.find(
      (i) => i.tipo === 'REMEDIO' && i.horario === '00:30',
    );
    expect(dada).toMatchObject({ feito: true, feitoPor: 'Ana' });
    await como(tokenBia, http().post(`/v1/tratamentos/${registro.id}/doses`))
      .send({ previstaPara: doses[1].previstaPara })
      .expect(404);
  });

  it('deve encerrar a rotina e cancelar os lembretes pendentes', async () => {
    await como(tokenAna, http().delete(`/v1/rotinas/${rotinaId}`)).expect(204);
    const pendentes = await prisma.notificacao.count({
      where: { origemTipo: 'ROTINA', origemId: rotinaId, status: 'AGENDADA' },
    });
    expect(pendentes).toBe(0);
  });
});
