import { Module } from '@nestjs/common';
import { NotificacaoModule } from '../notificacao/notificacao.module';
import { PetModule } from '../pet/pet.module';
import { AgendamentosService } from './aplicacao/agendamentos.service';
import { AtendimentosService } from './aplicacao/atendimentos.service';
import { CatalogoService } from './aplicacao/catalogo.service';
import { ClientesService } from './aplicacao/clientes.service';
import { EmpresasPublicasService } from './aplicacao/empresas-publicas.service';
import { HorariosService } from './aplicacao/horarios.service';
import { SolicitacoesService } from './aplicacao/solicitacoes.service';
import { AgendamentosController } from './http/agendamentos.controller';
import { AtendimentosController } from './http/atendimentos.controller';
import { CatalogoController } from './http/catalogo.controller';
import {
  ClientesController,
  ConsentimentoClienteController,
} from './http/clientes.controller';
import { EmpresasPublicasController } from './http/empresas-publicas.controller';
import { HorariosController } from './http/horarios.controller';
import { SolicitacoesController } from './http/solicitacoes.controller';

@Module({
  imports: [NotificacaoModule, PetModule],
  controllers: [
    EmpresasPublicasController,
    CatalogoController,
    ClientesController,
    ConsentimentoClienteController,
    HorariosController,
    SolicitacoesController,
    AgendamentosController,
    AtendimentosController,
  ],
  providers: [
    CatalogoService,
    EmpresasPublicasService,
    ClientesService,
    HorariosService,
    SolicitacoesService,
    AgendamentosService,
    AtendimentosService,
  ],
  exports: [CatalogoService, ClientesService, HorariosService],
})
export class AtendimentoModule {}
