import { Module } from '@nestjs/common';
import { IntegracoesService } from './aplicacao/integracoes.service';
import { IntegracoesController } from './http/integracoes.controller';
import { LogsController } from './http/logs.controller';

@Module({
  controllers: [LogsController, IntegracoesController],
  providers: [IntegracoesService],
})
export class AdministracaoModule {}
