import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { FILA_WEBHOOKS, TENTATIVAS_WEBHOOK } from './webhook';
import type { EnvioWebhook, EventoWebhook } from './webhook';

/**
 * Publica um evento para os webhooks ativos que o assinam (`PublicadorWebhook` do ARQ-03).
 * O envio sai do worker, com até 5 tentativas e espera exponencial; publicar nunca derruba a
 * operação de origem.
 */
@Injectable()
export class PublicadorWebhook {
  private readonly log = new Logger(PublicadorWebhook.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(FILA_WEBHOOKS) private readonly fila: Queue,
  ) {}

  async publicar(
    evento: EventoWebhook,
    dados: Record<string, unknown>,
  ): Promise<void> {
    try {
      const webhooks = await this.prisma.webhook.findMany({
        where: { ativo: true, eventos: { has: evento } },
        select: { id: true },
      });
      if (webhooks.length === 0) return;
      const envio: EnvioWebhook = {
        id: randomUUID(),
        evento,
        criadoEm: new Date().toISOString(),
        dados,
      };
      await this.fila.addBulk(
        webhooks.map((w) => ({
          name: evento,
          data: { webhookId: w.id, envio },
          opts: {
            jobId: `${envio.id}_${w.id}`,
            attempts: TENTATIVAS_WEBHOOK,
            backoff: { type: 'exponential', delay: 30_000 },
            removeOnComplete: 1000,
            removeOnFail: 5000,
          },
        })),
      );
    } catch (erro) {
      this.log.error(`Falha ao publicar ${evento}: ${String(erro)}`);
    }
  }
}
