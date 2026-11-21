import { Module } from '@nestjs/common';
import { NotificacaoModule } from '../notificacao/notificacao.module';
import { PetModule } from '../pet/pet.module';
import { AlimentacaoService } from './aplicacao/alimentacao.service';
import { EventosService } from './aplicacao/eventos.service';
import { AlimentacaoController } from './http/alimentacao.controller';
import { EventosController } from './http/eventos.controller';

@Module({
  imports: [PetModule, NotificacaoModule],
  controllers: [EventosController, AlimentacaoController],
  providers: [EventosService, AlimentacaoService],
})
export class RotinaModule {}
