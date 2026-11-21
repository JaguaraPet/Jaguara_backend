import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../compartilhado/prisma/prisma.module';
import { AgendaNotificacoesService } from './aplicacao/agenda-notificacoes.service';
import { FILA_EMAIL, FilaEmailService } from './aplicacao/fila-email.service';

/** Lado da API: coloca notificações e e-mails nas filas. */
@Module({
  imports: [PrismaModule, BullModule.registerQueue({ name: FILA_EMAIL })],
  providers: [FilaEmailService, AgendaNotificacoesService],
  exports: [FilaEmailService, AgendaNotificacoesService],
})
export class NotificacaoModule {}
