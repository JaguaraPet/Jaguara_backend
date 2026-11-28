import { TermosPadraoService } from './aplicacao/termos-padrao.service';
import { Module } from '@nestjs/common';
import { PrivacidadeService } from './aplicacao/privacidade.service';
import { PrivacidadeController } from './http/privacidade.controller';

@Module({
  controllers: [PrivacidadeController],
  providers: [PrivacidadeService, TermosPadraoService],
})
export class PrivacidadeModule {}
