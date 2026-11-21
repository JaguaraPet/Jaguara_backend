import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PagamentosService } from '../aplicacao/pagamentos.service';

export const FILA_ROTINAS_FINANCEIRO = 'rotinas-financeiro';

/** De hora em hora, confere no gateway os pagamentos que seguem pendentes (webhook perdido). */
@Processor(FILA_ROTINAS_FINANCEIRO)
export class ReconciliacaoPagamentosProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(ReconciliacaoPagamentosProcessor.name);

  constructor(
    @InjectQueue(FILA_ROTINAS_FINANCEIRO) private readonly fila: Queue,
    private readonly pagamentos: PagamentosService,
  ) {
    super();
  }

  async onApplicationBootstrap() {
    await this.fila.upsertJobScheduler(
      'reconciliacao-pagamentos',
      { pattern: '0 * * * *', tz: 'America/Sao_Paulo' },
      { name: 'reconciliacao-pagamentos' },
    );
  }

  async process(): Promise<number> {
    const alterados = await this.pagamentos.reconciliar();
    this.logger.log(`Pagamentos reconciliados: ${alterados}`);
    return alterados;
  }
}
