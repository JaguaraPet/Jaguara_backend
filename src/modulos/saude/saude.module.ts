import { Module } from '@nestjs/common';
import { NotificacaoModule } from '../notificacao/notificacao.module';
import { PetModule } from '../pet/pet.module';
import { ExamesService } from './aplicacao/exames.service';
import { PoliticaSaude } from './aplicacao/politica-saude';
import { TratamentosService } from './aplicacao/tratamentos.service';
import { VacinacoesService } from './aplicacao/vacinacoes.service';
import { ExamesController } from './http/exames.controller';
import { TratamentosController } from './http/tratamentos.controller';
import { VacinacoesController } from './http/vacinacoes.controller';

@Module({
  imports: [PetModule, NotificacaoModule],
  controllers: [VacinacoesController, TratamentosController, ExamesController],
  providers: [
    PoliticaSaude,
    VacinacoesService,
    TratamentosService,
    ExamesService,
  ],
  exports: [PoliticaSaude],
})
export class SaudeModule {}
