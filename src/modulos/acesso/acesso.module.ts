import { Module } from '@nestjs/common';
import { NotificacaoModule } from '../notificacao/notificacao.module';
import { AutenticacaoService } from './aplicacao/autenticacao.service';
import { CadastroService } from './aplicacao/cadastro.service';
import { CatalogoAcessoService } from './aplicacao/catalogo-acesso.service';
import { AutenticacaoController } from './http/autenticacao.controller';
import { CadastroController } from './http/cadastro.controller';

@Module({
  imports: [NotificacaoModule],
  controllers: [AutenticacaoController, CadastroController],
  providers: [AutenticacaoService, CadastroService, CatalogoAcessoService],
  exports: [AutenticacaoService, CatalogoAcessoService],
})
export class AcessoModule {}
