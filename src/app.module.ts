import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validarAmbiente } from './compartilhado/config/ambiente';
import { ArquivosModule } from './compartilhado/arquivos/armazenamento';
import { AuditoriaModule } from './compartilhado/auditoria/auditoria.module';
import { AuthModule } from './compartilhado/auth/auth.module';
import { FilasModule } from './compartilhado/filas/filas.module';
import { IdRequisicaoMiddleware } from './compartilhado/http/id-requisicao.middleware';
import { RedisModule } from './compartilhado/redis/redis.module';
import { PrismaModule } from './compartilhado/prisma/prisma.module';
import { StatusModule } from './compartilhado/status/status.module';
import { WebhooksModule } from './compartilhado/webhooks/webhooks.module';
import { AcessoModule } from './modulos/acesso/acesso.module';
import { PetModule } from './modulos/pet/pet.module';
import { DemonstracaoModule } from './modulos/demonstracao/demonstracao.module';
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
    ConfigModule.forRoot({ isGlobal: true, validate: validarAmbiente }),
    PrismaModule,
    RedisModule,
    FilasModule,
    WebhooksModule,
    ArquivosModule,
    AuthModule,
    AuditoriaModule,
    StatusModule,
    AcessoModule,
    PetModule,
    DemonstracaoModule,
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
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(IdRequisicaoMiddleware).forRoutes('{*caminho}');
  }
}
