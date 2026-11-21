import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../compartilhado/prisma/prisma.module';
import { AgendaNotificacoesService } from './aplicacao/agenda-notificacoes.service';
import { ConfiguracoesNotificacaoService } from './aplicacao/configuracoes-notificacao.service';
import { FILA_EMAIL, FilaEmailService } from './aplicacao/fila-email.service';
import { NotificacoesController } from './http/notificacoes.controller';

/** Lado da API: coloca notificações e e-mails nas filas. */
@Module({
  imports: [PrismaModule, BullModule.registerQueue({ name: FILA_EMAIL })],
  controllers: [NotificacoesController],
  providers: [
    FilaEmailService,
    AgendaNotificacoesService,
    ConfiguracoesNotificacaoService,
  ],
  exports: [FilaEmailService, AgendaNotificacoesService],
})
export class NotificacaoModule {}
