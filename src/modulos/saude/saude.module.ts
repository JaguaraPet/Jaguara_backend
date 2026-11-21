import { Module } from '@nestjs/common';
import { NotificacaoModule } from '../notificacao/notificacao.module';
import { PetModule } from '../pet/pet.module';
import { PoliticaSaude } from './aplicacao/politica-saude';
import { TratamentosService } from './aplicacao/tratamentos.service';
import { VacinacoesService } from './aplicacao/vacinacoes.service';
import { TratamentosController } from './http/tratamentos.controller';
import { VacinacoesController } from './http/vacinacoes.controller';

@Module({
  imports: [PetModule, NotificacaoModule],
  controllers: [VacinacoesController, TratamentosController],
  providers: [PoliticaSaude, VacinacoesService, TratamentosService],
  exports: [PoliticaSaude],
})
export class SaudeModule {}
