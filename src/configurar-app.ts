import {
  INestApplication,
  UnprocessableEntityException,
  ValidationPipe,
} from '@nestjs/common';
import helmet from 'helmet';
import { ProblemaFilter } from './compartilhado/erros/problema.filter';

/**
 * Configuração HTTP comum à API e aos testes: prefixo da versão (OpenAPI: /v1),
 * validação dos DTOs e erros no formato application/problem+json.
 */
export function configurarApp(app: INestApplication): INestApplication {
  // Cabeçalhos de segurança e CORS só para a web Enterprise (ADR-012, passo 1).
  app.use(helmet());
  app.enableCors({
    origin: (process.env.URL_WEB ?? '').split(',').filter(Boolean),
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
  });
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (erros) =>
        // Dados inválidos respondem 422, como no contrato OpenAPI (resposta Validacao).
        new UnprocessableEntityException({
          campos: erros.flatMap((erro) =>
            Object.values(erro.constraints ?? {}).map((mensagem) => ({
              campo: erro.property,
              mensagem,
            })),
          ),
        }),
    }),
  );
  app.useGlobalFilters(new ProblemaFilter());
  return app;
}
