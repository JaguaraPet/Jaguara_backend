import { Module } from '@nestjs/common';
import { AcessoModule } from '../acesso/acesso.module';
import { DemonstracaoService } from './aplicacao/demonstracao.service';
import { DemonstracaoController } from './http/demonstracao.controller';

@Module({
  imports: [AcessoModule],
  controllers: [DemonstracaoController],
  providers: [DemonstracaoService],
})
export class DemonstracaoModule {}
