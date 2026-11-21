import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../compartilhado/prisma/prisma.module';
import { NotificacaoModule } from '../notificacao/notificacao.module';
import { ClientesService } from './aplicacao/clientes.service';
import {
  FILA_ROTINAS_ATENDIMENTO,
  LimpezaPreCadastrosProcessor,
} from './infra/limpeza-pre-cadastros.processor';

/** Rotinas do atendimento no worker. */
@Module({
  imports: [
    PrismaModule,
    NotificacaoModule,
    BullModule.registerQueue({ name: FILA_ROTINAS_ATENDIMENTO }),
  ],
  providers: [ClientesService, LimpezaPreCadastrosProcessor],
})
export class AtendimentoWorkerModule {}
