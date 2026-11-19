import { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { parse } from 'yaml';
import { gerarDocumentoOpenApi } from '../src/compartilhado/http/swagger';
import { criarAppTeste } from './utils/app';

interface Contrato {
  paths: Record<string, Record<string, { security?: unknown[] }>>;
}

const METODOS = ['get', 'post', 'put', 'patch', 'delete'];

/**
 * A API não pode divergir do contrato (JAG-95): toda rota implementada precisa existir no
 * openapi.yaml do Jaguara_doc, com o mesmo método. A cópia fica em contrato/openapi.yaml.
 */
describe('Contrato OpenAPI', () => {
  let app: INestApplication<App>;
  const contrato = parse(
    readFileSync(join(__dirname, '..', 'contrato', 'openapi.yaml'), 'utf8'),
  ) as Contrato;

  beforeAll(async () => {
    app = await criarAppTeste();
  });

  afterAll(async () => {
    await app.close();
  });

  it('deve ter no contrato todas as rotas implementadas pela API', () => {
    const documento = gerarDocumentoOpenApi(app);
    const foraDoContrato: string[] = [];
    for (const [caminho, operacoes] of Object.entries(documento.paths)) {
      const semPrefixo = caminho.replace(/^\/v1/, '');
      for (const metodo of METODOS) {
        if (!(metodo in operacoes)) continue;
        if (!contrato.paths[semPrefixo]?.[metodo]) {
          foraDoContrato.push(`${metodo.toUpperCase()} ${semPrefixo}`);
        }
      }
    }
    expect(foraDoContrato).toEqual([]);
  });

  it('deve publicar o Swagger UI fora de produção', async () => {
    await request(app.getHttpServer()).get('/v1/docs').expect(200);
  });
});
