import { Module } from '@nestjs/common';
import { ContasService } from './aplicacao/contas.service';
import { IntegracoesService } from './aplicacao/integracoes.service';
import { ContasController } from './http/contas.controller';
import { IntegracoesController } from './http/integracoes.controller';
import { LogsController } from './http/logs.controller';

@Module({
  controllers: [LogsController, IntegracoesController, ContasController],
  providers: [IntegracoesService, ContasService],
})
export class AdministracaoModule {}
