import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Ambiente } from '../config/ambiente';

export const REDIS = Symbol('Redis');

/** Cliente Redis da API (lista de sessões revogadas, ADR-012). */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Ambiente, true>) =>
        new Redis(config.get('REDIS_URL', { infer: true }), {
          // Falha rápido: se o Redis cair, a camada de acesso consulta o banco (ADR-012).
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          lazyConnect: false,
        }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown() {
    await this.redis.quit().catch(() => undefined);
  }
}
