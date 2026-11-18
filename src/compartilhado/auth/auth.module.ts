import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { Ambiente } from '../config/ambiente';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AutenticacaoGuard } from './autenticacao.guard';
import { PermissoesGuard } from './permissoes.guard';
import { SessoesRevogadas } from './sessoes-revogadas';

/**
 * Camada de acesso única, registrada uma vez para todas as rotas (ADR-012):
 * limite por IP -> access token e sessões revogadas -> tipo de usuário e permissões.
 */
@Global()
@Module({
  imports: [
    // Limite de requisições por IP (ADR-012, passo 1). Desligado nos testes automatizados.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'geral', ttl: 60_000, limit: 300 }],
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Ambiente, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: {
          expiresIn: config.get('JWT_EXPIRACAO_MINUTOS', { infer: true }) * 60,
          algorithm: 'HS256',
        },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  providers: [
    SessoesRevogadas,
    // A ordem dos guards globais é a ordem da camada de acesso (ADR-012, DS-07).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AutenticacaoGuard },
    { provide: APP_GUARD, useClass: PermissoesGuard },
  ],
  exports: [JwtModule, SessoesRevogadas],
})
export class AuthModule {}
