import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { DadosEmail, PedidoEmail, TipoEmail } from '../dominio/email';
import { ehEmailDemonstracao } from '../../demonstracao/dominio/identificadores';

export const FILA_EMAIL = 'email';

/** Política de novas tentativas do envio de e-mail: até 5 tentativas com espera exponencial (ARQ-03, DS-06). */
export const TENTATIVAS_EMAIL = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
} as const;

/**
 * Coloca e-mails na fila; o worker envia fora da requisição HTTP (ADR-011).
 * A API nunca espera o provedor de e-mail responder.
 */
@Injectable()
export class FilaEmailService {
  constructor(
    @InjectQueue(FILA_EMAIL) private readonly fila: Queue<PedidoEmail>,
  ) {}

  async enviar<T extends TipoEmail>(
    tipo: T,
    para: string,
    dados: DadosEmail[T],
  ): Promise<void> {
    // Contas da demonstração usam um domínio reservado que nunca recebe e-mail.
    if (ehEmailDemonstracao(para)) return;
    await this.fila.add(tipo, { tipo, para, dados }, TENTATIVAS_EMAIL);
  }
}
