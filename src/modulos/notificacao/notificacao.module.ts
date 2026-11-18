import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { FILA_EMAIL, FilaEmailService } from './aplicacao/fila-email.service';

/** Lado da API: coloca notificações e e-mails nas filas. */
@Module({
  imports: [BullModule.registerQueue({ name: FILA_EMAIL })],
  providers: [FilaEmailService],
  exports: [FilaEmailService],
})
export class NotificacaoModule {}
