import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';
import { DisparoNotificacoesService } from '../aplicacao/disparo-notificacoes.service';

export const FILA_ROTINAS_NOTIFICACAO = 'rotinas-notificacao';

/** A cada minuto, o worker dispara as notificações que venceram (UC-31, DS-06). */
@Processor(FILA_ROTINAS_NOTIFICACAO)
export class DisparoNotificacoesProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(DisparoNotificacoesProcessor.name);

  constructor(
    @InjectQueue(FILA_ROTINAS_NOTIFICACAO) private readonly fila: Queue,
    private readonly disparo: DisparoNotificacoesService,
  ) {
    super();
  }

  async onApplicationBootstrap() {
    await this.fila.upsertJobScheduler(
      'disparo-notificacoes',
      { every: 60_000 },
      { name: 'disparo-notificacoes' },
    );
  }

  async process() {
    const resultado = await this.disparo.disparar();
    if (resultado.enviadas || resultado.falhas) {
      this.logger.log(
        `Notificações enviadas: ${resultado.enviadas}; falhas: ${resultado.falhas}`,
      );
    }
    return resultado;
  }
}
