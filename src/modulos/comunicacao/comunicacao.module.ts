import { Module } from '@nestjs/common';
import { PetModule } from '../pet/pet.module';
import { CanalTempoReal } from './aplicacao/canal-tempo-real';
import { ConversasService } from './aplicacao/conversas.service';
import { ChatGateway } from './http/chat.gateway';
import { ConversasController } from './http/conversas.controller';

@Module({
  imports: [PetModule],
  controllers: [ConversasController],
  providers: [CanalTempoReal, ConversasService, ChatGateway],
  exports: [CanalTempoReal, ConversasService],
})
export class ComunicacaoModule {}
