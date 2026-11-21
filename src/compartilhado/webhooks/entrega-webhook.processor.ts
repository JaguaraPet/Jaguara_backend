import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { Ambiente } from '../config/ambiente';
import { Cifragem } from '../cripto/cifragem';
import { PrismaService } from '../prisma/prisma.service';
import { assinar, FILA_WEBHOOKS, TENTATIVAS_WEBHOOK } from './webhook';
import type { EnvioWebhook } from './webhook';

/**
 * Entrega dos webhooks no worker (ARQ-03, seção 3.7): POST JSON com a assinatura HMAC;
 * resposta fora de 2xx faz o BullMQ tentar de novo, e a última falha vai para a auditoria.
 */
@Processor(FILA_WEBHOOKS)
export class EntregaWebhookProcessor extends WorkerHost {
  private readonly log = new Logger(EntregaWebhookProcessor.name);
  private readonly cifragem: Cifragem;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    config: ConfigService<Ambiente, true>,
  ) {
    super();
    this.cifragem = new Cifragem(
      config.get('CHAVE_CRIPTOGRAFIA', { infer: true }),
    );
  }

  async process(
    job: Job<{ webhookId: string; envio: EnvioWebhook }>,
  ): Promise<number> {
    const webhook = await this.prisma.webhook.findUnique({
      where: { id: job.data.webhookId },
    });
    if (!webhook || !webhook.ativo) return 0;
    const segredo = this.cifragem.decifrar(
      Buffer.from(webhook.segredoAssinatura, 'base64'),
    );
    const corpo = JSON.stringify(job.data.envio);
    const t = Math.floor(Date.now() / 1000);
    try {
      const resposta = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Jaguara-Webhooks/1.0',
          'X-Jaguara-Evento': job.data.envio.evento,
          'X-Jaguara-Id': job.data.envio.id,
          'X-Jaguara-Assinatura': assinar(segredo, corpo, t),
        },
        body: corpo,
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      return resposta.status;
    } catch (erro) {
      const ultima = job.attemptsMade + 1 >= TENTATIVAS_WEBHOOK;
      this.log.warn(
        `Webhook ${webhook.id} falhou (${job.attemptsMade + 1}/${TENTATIVAS_WEBHOOK}): ${String(erro)}`,
      );
      if (ultima) {
        await this.auditoria.registrar({
          acao: 'WEBHOOK_FALHOU',
          entidade: 'Webhook',
          entidadeId: webhook.id,
          nivel: 'ALERTA',
          detalhes: `${job.data.envio.evento} ${job.data.envio.id}: ${String(erro).slice(0, 300)}`,
        });
      }
      throw erro;
    }
  }
}
