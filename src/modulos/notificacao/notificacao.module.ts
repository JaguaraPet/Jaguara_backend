import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../compartilhado/prisma/prisma.module';
import { AgendaNotificacoesService } from './aplicacao/agenda-notificacoes.service';
import { ConfiguracoesNotificacaoService } from './aplicacao/configuracoes-notificacao.service';
import { FILA_EMAIL, FilaEmailService } from './aplicacao/fila-email.service';
import { NotificacoesController } from './http/notificacoes.controller';

/** Lado da API: coloca notificações e e-mails nas filas. */
import { DispositivosService } from './aplicacao/dispositivos.service';
import { DispositivosController } from './http/dispositivos.controller';

@Module({
  imports: [PrismaModule, BullModule.registerQueue({ name: FILA_EMAIL })],
  controllers: [NotificacoesController, DispositivosController],
  providers: [
    FilaEmailService,
    AgendaNotificacoesService,
    ConfiguracoesNotificacaoService,
    DispositivosService,
  ],
  exports: [FilaEmailService, AgendaNotificacoesService],
})
export class NotificacaoModule {}
