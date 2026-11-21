import { Module } from '@nestjs/common';
import { PrivacidadeService } from './aplicacao/privacidade.service';
import { PrivacidadeController } from './http/privacidade.controller';

@Module({
  controllers: [PrivacidadeController],
  providers: [PrivacidadeService],
})
export class PrivacidadeModule {}
