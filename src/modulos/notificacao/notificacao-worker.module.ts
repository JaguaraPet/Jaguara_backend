import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FILA_EMAIL } from './aplicacao/fila-email.service';
import { EmailProcessor } from './infra/email.processor';
import { criarEnvioEmail, ENVIO_EMAIL } from './infra/envio-email';

/** Lado do worker: processa as filas de notificação e e-mail. */
@Module({
  imports: [BullModule.registerQueue({ name: FILA_EMAIL })],
  providers: [
    EmailProcessor,
    {
      provide: ENVIO_EMAIL,
      inject: [ConfigService],
      useFactory: criarEnvioEmail,
    },
  ],
})
export class NotificacaoWorkerModule {}
