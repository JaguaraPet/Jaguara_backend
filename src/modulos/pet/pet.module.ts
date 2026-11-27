import { Module } from '@nestjs/common';
import { CatalogoEspeciesService } from './aplicacao/catalogo-especies.service';
import { NotificacaoModule } from '../notificacao/notificacao.module';
import { CompartilhamentosService } from './aplicacao/compartilhamentos.service';
import { MemorialService } from './aplicacao/memorial.service';
import { PetsService } from './aplicacao/pets.service';
import { PoliticaAcessoPet } from './aplicacao/politica-acesso-pet';
import { ResponsaveisService } from './aplicacao/responsaveis.service';
import { CompartilhamentosController } from './http/compartilhamentos.controller';
import { MemorialController } from './http/memorial.controller';
import { PetsController } from './http/pets.controller';
import { ResponsaveisController } from './http/responsaveis.controller';

@Module({
  imports: [NotificacaoModule],
  controllers: [
    PetsController,
    CompartilhamentosController,
    ResponsaveisController,
    MemorialController,
  ],
  providers: [
    PetsService,
    PoliticaAcessoPet,
    CompartilhamentosService,
    ResponsaveisService,
    MemorialService,
    CatalogoEspeciesService,
  ],
  exports: [PetsService, PoliticaAcessoPet],
})
export class PetModule {}
