import { Module } from '@nestjs/common';
import { ContasService } from './aplicacao/contas.service';
import { IntegracoesService } from './aplicacao/integracoes.service';
import { PermissoesGlobaisService } from './aplicacao/permissoes-globais.service';
import { ContasController } from './http/contas.controller';
import { IntegracoesController } from './http/integracoes.controller';
import { LogsController } from './http/logs.controller';
import { PermissoesGlobaisController } from './http/permissoes-globais.controller';

@Module({
  controllers: [
    LogsController,
    IntegracoesController,
    ContasController,
    PermissoesGlobaisController,
  ],
  providers: [IntegracoesService, ContasService, PermissoesGlobaisService],
})
export class AdministracaoModule {}
