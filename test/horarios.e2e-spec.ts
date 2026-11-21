import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarEmpresa, criarProfissional, entrar } from './utils/cenario';

describe('UC-24 · Horários de atuação (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let empresaId: string;
  let token: string;
  let profissionalId: string;
  let recursoId: string;

  const http = () => request(app.getHttpServer());
  const autorizado = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`);
  const horarios = () => `/v1/empresas/${empresaId}/horarios-atuacao`;

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    empresaId = await criarEmpresa(app, prisma, 'clinica@exemplo.com');
    token = await entrar(app, 'clinica@exemplo.com');
    profissionalId = await criarProfissional(
      prisma,
      empresaId,
      'vet@exemplo.com',
    );
    recursoId = (
      await prisma.recurso.create({
        data: { empresaId, nome: 'Consultório 1', tipo: 'SALA', ativo: true },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('CT-24-01: deve registrar o horário das 8h às 12h quando o profissional não tem horário às segundas de manhã', async () => {
    const criado = await autorizado(http().post(horarios()))
      .send({
        diaSemana: 'SEGUNDA',
        horaInicio: '08:00',
        horaFim: '12:00',
        funcionarioId: profissionalId,
      })
      .expect(201);
    expect(criado.body).toMatchObject({
      diaSemana: 'SEGUNDA',
      horaInicio: '08:00',
      horaFim: '12:00',
      funcionarioId: profissionalId,
    });
  });

  it('deve recusar horário sobreposto do mesmo profissional (RN29)', async () => {
    const resposta = await autorizado(http().post(horarios()))
      .send({
        diaSemana: 'SEGUNDA',
        horaInicio: '11:00',
        horaFim: '13:00',
        funcionarioId: profissionalId,
      })
      .expect(409);
    expect(resposta.body).toMatchObject({ codigo: 'HORARIO_SOBREPOSTO' });
  });

  it('deve exigir só um entre profissional e recurso e o fim depois do início', async () => {
    await autorizado(http().post(horarios()))
      .send({
        diaSemana: 'TERCA',
        horaInicio: '08:00',
        horaFim: '12:00',
        funcionarioId: profissionalId,
        recursoId,
      })
      .expect(422);
    await autorizado(http().post(horarios()))
      .send({
        diaSemana: 'TERCA',
        horaInicio: '12:00',
        horaFim: '08:00',
        recursoId,
      })
      .expect(422);
  });

  it('deve listar e remover horários de recursos', async () => {
    const criado = await autorizado(http().post(horarios()))
      .send({
        diaSemana: 'TERCA',
        horaInicio: '08:00',
        horaFim: '18:00',
        recursoId,
      })
      .expect(201);
    const lista = await autorizado(http().get(horarios())).expect(200);
    expect(lista.body).toHaveLength(2);
    await autorizado(
      http().delete(
        `/v1/horarios-atuacao/${(criado.body as { id: string }).id}`,
      ),
    ).expect(204);
    const depois = await autorizado(http().get(horarios())).expect(200);
    expect(depois.body).toHaveLength(1);
  });
});
