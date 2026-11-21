import { Module } from '@nestjs/common';
import { CatalogoService } from './aplicacao/catalogo.service';
import { CatalogoController } from './http/catalogo.controller';

@Module({
  controllers: [CatalogoController],
  providers: [CatalogoService],
  exports: [CatalogoService],
})
export class AtendimentoModule {}
