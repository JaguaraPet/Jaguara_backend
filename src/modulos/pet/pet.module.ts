import { Module } from '@nestjs/common';
import { PetsService } from './aplicacao/pets.service';
import { PoliticaAcessoPet } from './aplicacao/politica-acesso-pet';
import { PetsController } from './http/pets.controller';

@Module({
  controllers: [PetsController],
  providers: [PetsService, PoliticaAcessoPet],
  exports: [PetsService, PoliticaAcessoPet],
})
export class PetModule {}
