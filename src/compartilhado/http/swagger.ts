import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

/** Documento OpenAPI gerado a partir dos controladores e DTOs da API. */
export function gerarDocumentoOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Jaguara API')
    .setDescription(
      'Documentação gerada pela API. O contrato oficial é o openapi.yaml do Jaguara_doc (cópia em contrato/openapi.yaml).',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}

/** Swagger UI em /v1/docs, só fora de produção (JAG-95). */
export function publicarSwagger(app: INestApplication): void {
  if (process.env.NODE_ENV === 'production') return;
  SwaggerModule.setup('v1/docs', app, () => gerarDocumentoOpenApi(app));
}
