import { Logger } from '@nestjs/common';

/** Porta do serviço de push (DS-06, PushAdapter). */
export interface EnvioPush {
  readonly nome: string;
  /** Lança erro quando o serviço de push recusa ou não responde. */
  enviar(
    destinatarioId: string,
    titulo: string,
    mensagem: string,
  ): Promise<void>;
}

export const ENVIO_PUSH = Symbol('ENVIO_PUSH');

/**
 * Envio de push sem provedor configurado: registra no log e conta como enviado. A notificação
 * também aparece na lista do app (GET /notificacoes).
 */
export class EnvioPushSimulado implements EnvioPush {
  readonly nome = 'simulado';
  private readonly log = new Logger(EnvioPushSimulado.name);

  enviar(destinatarioId: string, titulo: string): Promise<void> {
    this.log.log(`Push para ${destinatarioId}: ${titulo}`);
    return Promise.resolve();
  }
}
