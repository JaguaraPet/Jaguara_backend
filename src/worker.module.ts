import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validarAmbiente } from './compartilhado/config/ambiente';

/** Módulo do worker: processadores de filas BullMQ (ADR-011). */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validarAmbiente }),
  ],
})
export class WorkerModule {}
