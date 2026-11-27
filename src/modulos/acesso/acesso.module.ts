import { Module } from '@nestjs/common';
import { AtendimentoModule } from '../atendimento/atendimento.module';
import { NotificacaoModule } from '../notificacao/notificacao.module';
import { AutenticacaoService } from './aplicacao/autenticacao.service';
import { RecuperacaoSenhaService } from './aplicacao/recuperacao-senha.service';
import { CadastroService } from './aplicacao/cadastro.service';
import { CatalogoAcessoService } from './aplicacao/catalogo-acesso.service';
import { FuncionariosService } from './aplicacao/funcionarios.service';
import { AutenticacaoController } from './http/autenticacao.controller';
import { CadastroController } from './http/cadastro.controller';
import { FuncionariosController } from './http/funcionarios.controller';
import { LoginSocialService } from './aplicacao/login-social.service';
import { LoginSocialController } from './http/login-social.controller';
import { VerificadorIdentidade } from './infra/verificador-identidade';

import { PerfisService } from './aplicacao/perfis.service';
import { PerfisController } from './http/perfis.controller';

@Module({
  imports: [NotificacaoModule, AtendimentoModule],
  controllers: [
    AutenticacaoController,
    CadastroController,
    FuncionariosController,
    PerfisController,
    LoginSocialController,
  ],
  providers: [
    AutenticacaoService,
    RecuperacaoSenhaService,
    CadastroService,
    CatalogoAcessoService,
    FuncionariosService,
    PerfisService,
    LoginSocialService,
    // Fábrica: o verificador recebe o fetch no construtor (os testes trocam por um falso).
    {
      provide: VerificadorIdentidade,
      useFactory: () => new VerificadorIdentidade(),
    },
  ],
  exports: [AutenticacaoService, CatalogoAcessoService],
})
export class AcessoModule {}
