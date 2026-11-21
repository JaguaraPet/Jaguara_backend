import { Module } from '@nestjs/common';
import { CatalogoService } from './aplicacao/catalogo.service';
import { EmpresasPublicasService } from './aplicacao/empresas-publicas.service';
import { CatalogoController } from './http/catalogo.controller';
import { EmpresasPublicasController } from './http/empresas-publicas.controller';

@Module({
  controllers: [EmpresasPublicasController, CatalogoController],
  providers: [CatalogoService, EmpresasPublicasService],
  exports: [CatalogoService],
})
export class AtendimentoModule {}
