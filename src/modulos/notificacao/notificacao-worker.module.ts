import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditoriaModule } from '../../compartilhado/auditoria/auditoria.module';
import { PrismaModule } from '../../compartilhado/prisma/prisma.module';
import { DisparoNotificacoesService } from './aplicacao/disparo-notificacoes.service';
import { FILA_EMAIL, FilaEmailService } from './aplicacao/fila-email.service';
import {
  DisparoNotificacoesProcessor,
  FILA_ROTINAS_NOTIFICACAO,
} from './infra/disparo-notificacoes.processor';
import { EmailProcessor } from './infra/email.processor';
import { criarEnvioEmail, ENVIO_EMAIL } from './infra/envio-email';
import { ENVIO_PUSH, EnvioPushSimulado } from './infra/envio-push';

/** Lado do worker: processa as filas de notificação e e-mail. */
@Module({
  imports: [
    PrismaModule,
    AuditoriaModule,
    BullModule.registerQueue({ name: FILA_EMAIL }),
    BullModule.registerQueue({ name: FILA_ROTINAS_NOTIFICACAO }),
  ],
  providers: [
    EmailProcessor,
    FilaEmailService,
    DisparoNotificacoesService,
    DisparoNotificacoesProcessor,
    { provide: ENVIO_PUSH, useClass: EnvioPushSimulado },
    {
      provide: ENVIO_EMAIL,
      inject: [ConfigService],
      useFactory: criarEnvioEmail,
    },
  ],
})
export class NotificacaoWorkerModule {}
