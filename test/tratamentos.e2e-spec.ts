import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarPet, criarTutor, entrar } from './utils/cenario';

interface Tratamento {
  id: string;
  status: string;
  lembretesAgendados?: number;
}

describe('UC-14 · Tratamentos medicamentosos com lembretes (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let tokenAna: string;
  let petId: string;
  let tratamento: Tratamento;

  const http = () => request(app.getHttpServer());
  const como = (r: request.Test) =>
    r.set('Authorization', `Bearer ${tokenAna}`);
  const dia = (dias: number) =>
    new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    const anaId = await criarTutor(prisma, 'ana@exemplo.com', 'Ana');
    tokenAna = await entrar(app, 'ana@exemplo.com');
    const caioId = await criarTutor(prisma, 'caio@exemplo.com', 'Caio');
    petId = await criarPet(prisma, anaId);
    await prisma.responsavelPet.create({
      data: {
        petId,
        tutorId: caioId,
        tipo: 'ADICIONAL',
        ativo: true,
        dataVinculo: new Date(),
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('CT-14-01: deve agendar os lembretes de 8 em 8 horas para os responsáveis', async () => {
    const resposta = await como(
      http()
        .post(`/v1/pets/${petId}/tratamentos`)
        .send({
          medicamento: 'Amoxicilina',
          dosagem: '1 comprimido',
          viaAdministracao: 'Oral',
          intervaloHoras: 8,
          dataInicio: dia(1),
          dataFim: dia(2),
        }),
    ).expect(201);
    tratamento = resposta.body as Tratamento;
    // De 8 em 8 horas a partir das 8h, em dois dias: 8h, 16h, 0h, 8h e 16h, para dois responsáveis.
    expect(tratamento).toMatchObject({
      status: 'ATIVO',
      lembretesAgendados: 10,
    });
    const destinatarios = await prisma.notificacao.groupBy({
      by: ['destinatarioId'],
      where: { origemId: tratamento.id, status: 'AGENDADA' },
      _count: true,
    });
    expect(destinatarios).toHaveLength(2);
    const lista = await como(
      http().get(`/v1/pets/${petId}/tratamentos`),
    ).expect(200);
    expect(lista.body).toEqual([
      expect.objectContaining({ id: tratamento.id }),
    ]);
  });

  it('CT-14-02: deve cancelar os lembretes pendentes ao finalizar', async () => {
    await como(
      http().post(`/v1/tratamentos/${tratamento.id}/finalizacao`),
    ).expect(204);
    const pendentes = await prisma.notificacao.count({
      where: { origemId: tratamento.id, status: 'AGENDADA' },
    });
    expect(pendentes).toBe(0);
    const gravado = await prisma.tratamentoMedicamentoso.findUniqueOrThrow({
      where: { id: tratamento.id },
    });
    expect(gravado.status).toBe('FINALIZADO');
  });

  it('deve recusar intervalo inválido e fim antes do início', async () => {
    const base = {
      medicamento: 'Vermífugo',
      dosagem: '1 ml',
      viaAdministracao: 'Oral',
      dataInicio: dia(1),
    };
    await como(
      http()
        .post(`/v1/pets/${petId}/tratamentos`)
        .send({ ...base, intervaloHoras: 0 }),
    ).expect(422);
    await como(
      http()
        .post(`/v1/pets/${petId}/tratamentos`)
        .send({ ...base, intervaloHoras: 24, dataFim: dia(0) }),
    ).expect(422);
  });
});
