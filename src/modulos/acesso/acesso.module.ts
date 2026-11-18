import { Module } from '@nestjs/common';
import { AutenticacaoService } from './aplicacao/autenticacao.service';
import { AutenticacaoController } from './http/autenticacao.controller';

@Module({
  controllers: [AutenticacaoController],
  providers: [AutenticacaoService],
  exports: [AutenticacaoService],
})
export class AcessoModule {}
