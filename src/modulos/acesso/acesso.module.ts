import { Module } from '@nestjs/common';
import { AtendimentoModule } from '../atendimento/atendimento.module';
import { NotificacaoModule } from '../notificacao/notificacao.module';
import { AutenticacaoService } from './aplicacao/autenticacao.service';
import { CadastroService } from './aplicacao/cadastro.service';
import { CatalogoAcessoService } from './aplicacao/catalogo-acesso.service';
import { FuncionariosService } from './aplicacao/funcionarios.service';
import { AutenticacaoController } from './http/autenticacao.controller';
import { CadastroController } from './http/cadastro.controller';
import { FuncionariosController } from './http/funcionarios.controller';

@Module({
  imports: [NotificacaoModule, AtendimentoModule],
  controllers: [
    AutenticacaoController,
    CadastroController,
    FuncionariosController,
  ],
  providers: [
    AutenticacaoService,
    CadastroService,
    CatalogoAcessoService,
    FuncionariosService,
  ],
  exports: [AutenticacaoService, CatalogoAcessoService],
})
export class AcessoModule {}
