import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validarAmbiente } from './compartilhado/config/ambiente';
import { FilasModule } from './compartilhado/filas/filas.module';
import { AtendimentoWorkerModule } from './modulos/atendimento/atendimento-worker.module';
import { FinanceiroWorkerModule } from './modulos/financeiro/financeiro-worker.module';
import { NotificacaoWorkerModule } from './modulos/notificacao/notificacao-worker.module';

/** Módulo do worker: processadores das filas BullMQ (ADR-011). */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validarAmbiente }),
    FilasModule,
    NotificacaoWorkerModule,
    AtendimentoWorkerModule,
    FinanceiroWorkerModule,
  ],
})
export class WorkerModule {}
