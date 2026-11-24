import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarPet, criarTutor, entrar } from './utils/cenario';

/** Sem credenciais do Google, a API usa o calendário simulado: o fluxo inteiro roda local. */
describe('UC-09 · Sincronização com calendário externo (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let tokenAna: string;
  let tokenBia: string;
  let petId: string;

  const http = () => request(app.getHttpServer());
  const como = (t: string, r: request.Test) =>
    r.set('Authorization', `Bearer ${t}`);

  async function autorizar(token: string, negar = false) {
    const pedido = await como(
      token,
      http().post('/v1/calendario-externo/google/autorizacao'),
    ).expect(201);
    const url = new URL((pedido.body as { url: string }).url);
    const estado = url.searchParams.get('state')!;
    const consulta = negar
      ? `error=access_denied&state=${encodeURIComponent(estado)}`
      : url.search.slice(1);
    return http()
      .get(`/v1/calendario-externo/google/retorno?${consulta}`)
      .expect(302);
  }

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    const anaId = await criarTutor(prisma, 'ana@exemplo.com', 'Ana');
    tokenAna = await entrar(app, 'ana@exemplo.com');
    await criarTutor(prisma, 'bia@exemplo.com', 'Bia');
    tokenBia = await entrar(app, 'bia@exemplo.com');
    petId = await criarPet(prisma, anaId, 'Thor');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('CT-09-02: deve cancelar quando o tutor nega o acesso e não importar nada', async () => {
    const retorno = await autorizar(tokenAna, true);
    expect(retorno.headers.location).toMatch(/\/calendario\?resultado=negado$/);
    await como(tokenAna, http().get('/v1/calendario-externo')).expect(200, {});
    const sincronizar = await como(
      tokenAna,
      http().post(`/v1/pets/${petId}/calendario-externo/sincronizacao`),
    ).expect(409);
    expect(sincronizar.body).toMatchObject({ codigo: 'RN13_SEM_AUTORIZACAO' });
    expect(await prisma.eventoCalendario.count()).toBe(0);
  });

  it('CT-09-01: deve autorizar e sincronizar os eventos com o calendário do pet', async () => {
    const retorno = await autorizar(tokenAna);
    expect(retorno.headers.location).toMatch(/resultado=conectado$/);
    const situacao = await como(
      tokenAna,
      http().get('/v1/calendario-externo'),
    ).expect(200);
    expect(situacao.body).toMatchObject({
      provedor: 'GOOGLE',
      autorizado: true,
    });

    const r = await como(
      tokenAna,
      http().post(`/v1/pets/${petId}/calendario-externo/sincronizacao`),
    ).expect(201);
    expect(r.body).toEqual({ importados: 2, atualizados: 0, removidos: 0 });
    const eventos = await como(
      tokenAna,
      http().get(`/v1/pets/${petId}/eventos`),
    ).expect(200);
    expect(
      (eventos.body as { titulo: string; origem: string }[]).filter(
        (e) => e.origem === 'CALENDARIO_EXTERNO',
      ),
    ).toHaveLength(2);

    const de_novo = await como(
      tokenAna,
      http().post(`/v1/pets/${petId}/calendario-externo/sincronizacao`),
    ).expect(201);
    expect(de_novo.body).toEqual({
      importados: 0,
      atualizados: 2,
      removidos: 0,
    });
  });

  it('deve negar o pet de outro tutor e desconectar apagando os importados', async () => {
    await autorizar(tokenBia);
    await como(
      tokenBia,
      http().post(`/v1/pets/${petId}/calendario-externo/sincronizacao`),
    ).expect(404);
    await como(tokenAna, http().delete('/v1/calendario-externo')).expect(204);
    expect(
      await prisma.eventoCalendario.count({
        where: { origem: 'CALENDARIO_EXTERNO' },
      }),
    ).toBe(0);
  });
});
