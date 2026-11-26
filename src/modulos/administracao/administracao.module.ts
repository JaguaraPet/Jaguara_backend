import { Module } from '@nestjs/common';
import { NotificacaoModule } from '../notificacao/notificacao.module';
import { ChamadosService } from './aplicacao/chamados.service';
import { ContasService } from './aplicacao/contas.service';
import { IntegracoesService } from './aplicacao/integracoes.service';
import { PermissoesGlobaisService } from './aplicacao/permissoes-globais.service';
import {
  ChamadosAdminController,
  ChamadosController,
} from './http/chamados.controller';
import { ContasController } from './http/contas.controller';
import { IntegracoesController } from './http/integracoes.controller';
import { LogsController } from './http/logs.controller';
import { PermissoesGlobaisController } from './http/permissoes-globais.controller';

@Module({
  imports: [NotificacaoModule],
  controllers: [
    LogsController,
    IntegracoesController,
    ContasController,
    PermissoesGlobaisController,
    ChamadosController,
    ChamadosAdminController,
  ],
  providers: [
    IntegracoesService,
    ContasService,
    PermissoesGlobaisService,
    ChamadosService,
  ],
})
export class AdministracaoModule {}
