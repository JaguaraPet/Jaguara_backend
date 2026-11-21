import { Module } from '@nestjs/common';
import { NotificacaoModule } from '../notificacao/notificacao.module';
import { CompartilhamentosService } from './aplicacao/compartilhamentos.service';
import { PetsService } from './aplicacao/pets.service';
import { PoliticaAcessoPet } from './aplicacao/politica-acesso-pet';
import { CompartilhamentosController } from './http/compartilhamentos.controller';
import { PetsController } from './http/pets.controller';

@Module({
  imports: [NotificacaoModule],
  controllers: [PetsController, CompartilhamentosController],
  providers: [PetsService, PoliticaAcessoPet, CompartilhamentosService],
  exports: [PetsService, PoliticaAcessoPet],
})
export class PetModule {}
