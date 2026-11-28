import { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { WorkerModule } from '../src/worker.module';

/**
 * O worker sobe com todos os processadores: pega dependência que falte só no módulo do worker
 * (o da API pode ter o provedor e o do worker não), o que derrubaria o contêiner ao iniciar.
 */
describe('Worker (integração)', () => {
  let app: INestApplicationContext | undefined;

  afterAll(async () => {
    await app?.close();
  });

  it('deve iniciar o módulo do worker com todas as dependências', async () => {
    const modulo = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();
    app = await modulo.init();
    expect(app).toBeDefined();
  });
});
