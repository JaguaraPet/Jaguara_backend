import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { FILA_EMAIL } from '../aplicacao/fila-email.service';
import { montarEmail, PedidoEmail } from '../dominio/email';
import { ENVIO_EMAIL } from './envio-email';
import type { EnvioEmail } from './envio-email';

/** Processa a fila de e-mails no worker. Falha lança erro para o BullMQ tentar de novo. */
@Processor(FILA_EMAIL)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(@Inject(ENVIO_EMAIL) private readonly envio: EnvioEmail) {
    super();
  }

  async process(job: Job<PedidoEmail>): Promise<void> {
    const mensagem = montarEmail(job.data);
    await this.envio.enviar(mensagem);
    // Não registra o endereço completo nos logs (minimização, ARQ-02).
    const [usuario, dominio] = job.data.para.split('@');
    this.logger.log(
      `E-mail ${job.data.tipo} enviado para ${usuario.slice(0, 2)}***@${dominio} (tentativa ${job.attemptsMade + 1})`,
    );
  }
}
