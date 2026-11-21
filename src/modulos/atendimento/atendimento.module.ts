import { Module } from '@nestjs/common';
import { NotificacaoModule } from '../notificacao/notificacao.module';
import { CatalogoService } from './aplicacao/catalogo.service';
import { ClientesService } from './aplicacao/clientes.service';
import { EmpresasPublicasService } from './aplicacao/empresas-publicas.service';
import { HorariosService } from './aplicacao/horarios.service';
import { CatalogoController } from './http/catalogo.controller';
import {
  ClientesController,
  ConsentimentoClienteController,
} from './http/clientes.controller';
import { EmpresasPublicasController } from './http/empresas-publicas.controller';
import { HorariosController } from './http/horarios.controller';

@Module({
  imports: [NotificacaoModule],
  controllers: [
    EmpresasPublicasController,
    CatalogoController,
    ClientesController,
    ConsentimentoClienteController,
    HorariosController,
  ],
  providers: [
    CatalogoService,
    EmpresasPublicasService,
    ClientesService,
    HorariosService,
  ],
  exports: [CatalogoService, ClientesService, HorariosService],
})
export class AtendimentoModule {}
