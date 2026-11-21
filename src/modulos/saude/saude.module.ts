import { Module } from '@nestjs/common';
import { NotificacaoModule } from '../notificacao/notificacao.module';
import { PetModule } from '../pet/pet.module';
import { PoliticaSaude } from './aplicacao/politica-saude';
import { VacinacoesService } from './aplicacao/vacinacoes.service';
import { VacinacoesController } from './http/vacinacoes.controller';

@Module({
  imports: [PetModule, NotificacaoModule],
  controllers: [VacinacoesController],
  providers: [PoliticaSaude, VacinacoesService],
  exports: [PoliticaSaude],
})
export class SaudeModule {}
