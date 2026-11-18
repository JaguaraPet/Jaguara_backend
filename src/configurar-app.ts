import {
  INestApplication,
  UnprocessableEntityException,
  ValidationPipe,
} from '@nestjs/common';
import { ProblemaFilter } from './compartilhado/erros/problema.filter';

/**
 * Configuração HTTP comum à API e aos testes: prefixo da versão (OpenAPI: /v1),
 * validação dos DTOs e erros no formato application/problem+json.
 */
export function configurarApp(app: INestApplication): INestApplication {
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
