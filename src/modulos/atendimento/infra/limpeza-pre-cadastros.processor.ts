import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ClientesService } from '../aplicacao/clientes.service';

export const FILA_ROTINAS_ATENDIMENTO = 'rotinas-atendimento';

/** Rotina diária, às 3h de Brasília, que exclui pré-cadastros vencidos (RN41, CT-21-05). */
@Processor(FILA_ROTINAS_ATENDIMENTO)
export class LimpezaPreCadastrosProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(LimpezaPreCadastrosProcessor.name);

  constructor(
    @InjectQueue(FILA_ROTINAS_ATENDIMENTO) private readonly fila: Queue,
    private readonly clientes: ClientesService,
  ) {
    super();
  }

  async onApplicationBootstrap() {
    await this.fila.upsertJobScheduler(
      'limpeza-pre-cadastros',
      { pattern: '0 3 * * *', tz: 'America/Sao_Paulo' },
      { name: 'limpeza-pre-cadastros' },
    );
  }

  async process(): Promise<number> {
    const excluidos = await this.clientes.limparPreCadastros();
    this.logger.log(`Pré-cadastros vencidos excluídos: ${excluidos}`);
    return excluidos;
  }
}
