import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configurarApp } from './configurar-app';

async function iniciar() {
  const app = configurarApp(await NestFactory.create(AppModule));
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
void iniciar();
