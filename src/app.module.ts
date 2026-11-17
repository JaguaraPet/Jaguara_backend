import { Module } from '@nestjs/common';
import { StatusModule } from './compartilhado/status/status.module';
import { AcessoModule } from './modulos/acesso/acesso.module';
import { PetModule } from './modulos/pet/pet.module';
import { SaudeModule } from './modulos/saude/saude.module';
import { RotinaModule } from './modulos/rotina/rotina.module';
import { NotificacaoModule } from './modulos/notificacao/notificacao.module';
import { AtendimentoModule } from './modulos/atendimento/atendimento.module';
import { FinanceiroModule } from './modulos/financeiro/financeiro.module';
import { ComunicacaoModule } from './modulos/comunicacao/comunicacao.module';
import { PrivacidadeModule } from './modulos/privacidade/privacidade.module';
import { AdministracaoModule } from './modulos/administracao/administracao.module';
import { RelatoriosModule } from './modulos/relatorios/relatorios.module';

@Module({
  imports: [
    StatusModule,
    AcessoModule,
    PetModule,
    SaudeModule,
    RotinaModule,
    NotificacaoModule,
    AtendimentoModule,
    FinanceiroModule,
    ComunicacaoModule,
    PrivacidadeModule,
    AdministracaoModule,
    RelatoriosModule,
  ],
})
export class AppModule {}
