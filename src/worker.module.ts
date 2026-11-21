import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validarAmbiente } from './compartilhado/config/ambiente';
import { AuditoriaModule } from './compartilhado/auditoria/auditoria.module';
import { FilasModule } from './compartilhado/filas/filas.module';
import { PrismaModule } from './compartilhado/prisma/prisma.module';
import { EntregaWebhookProcessor } from './compartilhado/webhooks/entrega-webhook.processor';
import { WebhooksModule } from './compartilhado/webhooks/webhooks.module';
import { AtendimentoWorkerModule } from './modulos/atendimento/atendimento-worker.module';
import { FinanceiroWorkerModule } from './modulos/financeiro/financeiro-worker.module';
import { NotificacaoWorkerModule } from './modulos/notificacao/notificacao-worker.module';

/** Módulo do worker: processadores das filas BullMQ (ADR-011). */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validarAmbiente }),
    FilasModule,
    PrismaModule,
    AuditoriaModule,
    WebhooksModule,
    NotificacaoWorkerModule,
    AtendimentoWorkerModule,
    FinanceiroWorkerModule,
  ],
  providers: [EntregaWebhookProcessor],
})
export class WorkerModule {}
