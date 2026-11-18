import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configurarApp } from '../../src/configurar-app';

/** Sobe a API inteira, com a mesma configuração do main.ts, para os testes de API. */
export async function criarAppTeste(): Promise<INestApplication<App>> {
  const modulo = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = configurarApp(
    modulo.createNestApplication<INestApplication<App>>(),
  );
  await app.init();
  return app as INestApplication<App>;
}
