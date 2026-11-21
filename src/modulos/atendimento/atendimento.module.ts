import { Module } from '@nestjs/common';
import { NotificacaoModule } from '../notificacao/notificacao.module';
import { CatalogoService } from './aplicacao/catalogo.service';
import { ClientesService } from './aplicacao/clientes.service';
import { EmpresasPublicasService } from './aplicacao/empresas-publicas.service';
import { CatalogoController } from './http/catalogo.controller';
import {
  ClientesController,
  ConsentimentoClienteController,
} from './http/clientes.controller';
import { EmpresasPublicasController } from './http/empresas-publicas.controller';

@Module({
  imports: [NotificacaoModule],
  controllers: [
    EmpresasPublicasController,
    CatalogoController,
    ClientesController,
    ConsentimentoClienteController,
  ],
  providers: [CatalogoService, EmpresasPublicasService, ClientesService],
  exports: [CatalogoService, ClientesService],
})
export class AtendimentoModule {}
