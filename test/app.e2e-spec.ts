import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { criarAppTeste } from './utils/app';

describe('API (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await criarAppTeste();
  });

  afterAll(async () => {
    await app.close();
  });

  it('deve responder 200 quando GET /v1/health é chamado', async () => {
    const resposta = await request(app.getHttpServer())
      .get('/v1/health')
      .expect(200);
    expect(resposta.body).toMatchObject({ status: 'ok' });
  });

  it('deve responder 404 em problem+json quando a rota não existe', async () => {
    const resposta = await request(app.getHttpServer()).get('/v1/nao-existe');
    expect(resposta.status).toBe(404);
    expect(resposta.headers['content-type']).toContain(
      'application/problem+json',
    );
  });
});
