import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Ambiente } from '../config/ambiente';

/** Conexão do BullMQ com o Redis (ADR-011), compartilhada pela API (produtora) e pelo worker. */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Ambiente, true>) => {
        const url = new URL(config.get('REDIS_URL', { infer: true }));
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            username: url.username || undefined,
            password: url.password || undefined,
            db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
            tls: url.protocol === 'rediss:' ? {} : undefined,
          },
          prefix: 'jaguara',
        };
      },
    }),
  ],
})
export class FilasModule {}
