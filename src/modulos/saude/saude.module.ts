import { Module } from '@nestjs/common';
import { NotificacaoModule } from '../notificacao/notificacao.module';
import { PetModule } from '../pet/pet.module';
import { AlergiasService } from './aplicacao/alergias.service';
import { ExamesService } from './aplicacao/exames.service';
import { LinhaDoTempoService } from './aplicacao/linha-do-tempo.service';
import { PoliticaSaude } from './aplicacao/politica-saude';
import { TratamentosService } from './aplicacao/tratamentos.service';
import { VacinacoesService } from './aplicacao/vacinacoes.service';
import { AlergiasController } from './http/alergias.controller';
import { ExamesController } from './http/exames.controller';
import { LinhaDoTempoController } from './http/linha-do-tempo.controller';
import { TratamentosController } from './http/tratamentos.controller';
import { VacinacoesController } from './http/vacinacoes.controller';

@Module({
  imports: [PetModule, NotificacaoModule],
  controllers: [
    VacinacoesController,
    TratamentosController,
    ExamesController,
    AlergiasController,
    LinhaDoTempoController,
  ],
  providers: [
    PoliticaSaude,
    VacinacoesService,
    TratamentosService,
    ExamesService,
    AlergiasService,
    LinhaDoTempoService,
  ],
  exports: [PoliticaSaude],
})
export class SaudeModule {}
