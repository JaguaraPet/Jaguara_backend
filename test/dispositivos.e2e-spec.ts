import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarTutor, entrar } from './utils/cenario';

const TOKEN = 'ExponentPushToken[aparelho-da-ana]';

describe('UC-31 · Aparelhos para push (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let tokenAna: string;
  let tokenBia: string;
  let biaId: string;

  const http = () => request(app.getHttpServer());
  const como = (t: string, r: request.Test) =>
    r.set('Authorization', `Bearer ${t}`);

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    await criarTutor(prisma, 'ana@exemplo.com', 'Ana');
    tokenAna = await entrar(app, 'ana@exemplo.com');
    biaId = await criarTutor(prisma, 'bia@exemplo.com', 'Bia');
    tokenBia = await entrar(app, 'bia@exemplo.com');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('deve registrar o aparelho e passá-lo para quem entrou depois', async () => {
    await como(
      tokenAna,
      http()
        .post('/v1/dispositivos')
        .send({ token: TOKEN, plataforma: 'android' }),
    ).expect(204);
    await como(
      tokenBia,
      http()
        .post('/v1/dispositivos')
        .send({ token: TOKEN, plataforma: 'android' }),
    ).expect(204);
    const aparelhos = await prisma.dispositivoPush.findMany();
    expect(aparelhos).toEqual([
      expect.objectContaining({ token: TOKEN, usuarioId: biaId }),
    ]);
  });

  it('deve recusar token fora do formato do Expo e exigir login', async () => {
    await como(
      tokenAna,
      http().post('/v1/dispositivos').send({ token: 'abc', plataforma: 'ios' }),
    ).expect(422);
    await http()
      .post('/v1/dispositivos')
      .send({ token: TOKEN, plataforma: 'ios' })
      .expect(401);
  });

  it('deve tirar o aparelho só da própria conta', async () => {
    const caminho = `/v1/dispositivos/${encodeURIComponent(TOKEN)}`;
    await como(tokenAna, http().delete(caminho)).expect(204);
    expect(await prisma.dispositivoPush.count()).toBe(1);
    await como(tokenBia, http().delete(caminho)).expect(204);
    expect(await prisma.dispositivoPush.count()).toBe(0);
  });
});
