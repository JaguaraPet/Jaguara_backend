import { Module } from '@nestjs/common';
import { NotificacaoModule } from '../notificacao/notificacao.module';
import { PetModule } from '../pet/pet.module';
import { EventosService } from './aplicacao/eventos.service';
import { EventosController } from './http/eventos.controller';

@Module({
  imports: [PetModule, NotificacaoModule],
  controllers: [EventosController],
  providers: [EventosService],
})
export class RotinaModule {}
