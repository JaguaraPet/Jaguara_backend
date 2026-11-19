import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import { once } from 'node:events';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { REDIS } from '../../src/compartilhado/redis/redis.module';
import { configurarApp } from '../../src/configurar-app';

/** Espera o Redis conectar: antes disso o guard consulta o banco (plano B da ADR-012). */
export async function esperarRedis(app: INestApplication): Promise<void> {
  const redis = app.get<Redis>(REDIS);
  if (redis.status !== 'ready') await once(redis, 'ready');
}

/** Sobe a API inteira, com a mesma configuração do main.ts, para os testes de API. */
export async function criarAppTeste(
  extras: {
    controllers?: Parameters<typeof Test.createTestingModule>[0]['controllers'];
  } = {},
): Promise<INestApplication<App>> {
  const modulo = await Test.createTestingModule({
    imports: [AppModule],
    controllers: extras.controllers,
  }).compile();
  const app = configurarApp(
    modulo.createNestApplication<INestApplication<App>>(),
  ) as INestApplication<App>;
  await app.init();
  await esperarRedis(app);
  return app;
}
