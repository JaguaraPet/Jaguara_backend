import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../compartilhado/prisma/prisma.module';
import { CanalTempoReal } from '../comunicacao/aplicacao/canal-tempo-real';
import { NotificacaoModule } from '../notificacao/notificacao.module';
import { PoliticaAcessoPet } from '../pet/aplicacao/politica-acesso-pet';
import { AssinaturasService } from './aplicacao/assinaturas.service';
import { PagamentosService } from './aplicacao/pagamentos.service';
import { provedorGateway } from './infra/gateway.provider';
import {
  FILA_ROTINAS_FINANCEIRO,
  ReconciliacaoPagamentosProcessor,
} from './infra/reconciliacao-pagamentos.processor';

/**
 * Rotinas do financeiro no worker. O worker não tem o servidor do Socket.IO: o canal de tempo
 * real fica sem efeito e o tutor vê o status atualizado na próxima consulta.
 */
@Module({
  imports: [
    PrismaModule,
    NotificacaoModule,
    BullModule.registerQueue({ name: FILA_ROTINAS_FINANCEIRO }),
  ],
  providers: [
    CanalTempoReal,
    PoliticaAcessoPet,
    PagamentosService,
    AssinaturasService,
    provedorGateway,
    ReconciliacaoPagamentosProcessor,
  ],
})
export class FinanceiroWorkerModule {}
