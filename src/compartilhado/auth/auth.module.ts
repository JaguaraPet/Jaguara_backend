import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { Ambiente } from '../config/ambiente';
import { AutenticacaoGuard } from './autenticacao.guard';
import { SessoesRevogadas } from './sessoes-revogadas';

/** Camada de acesso única, registrada uma vez para todas as rotas (ADR-012). */
@Global()
@Module({
  imports: [
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
    { provide: APP_GUARD, useClass: AutenticacaoGuard },
  ],
  exports: [JwtModule, SessoesRevogadas],
})
export class AuthModule {}
