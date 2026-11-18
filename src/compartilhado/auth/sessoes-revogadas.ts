import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';

/**
 * Lista de sessões revogadas no Redis (ADR-012, seção 2). Guarda o `sid` pelo tempo máximo
 * de vida do access token; depois disso o token já expirou sozinho. Se o Redis estiver fora,
 * consulta a sessão no banco: fica mais lento, mas nunca aceita um token revogado.
 */
@Injectable()
export class SessoesRevogadas {
  private readonly logger = new Logger(SessoesRevogadas.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  private chave(sid: string) {
    return `jaguara:sessao-revogada:${sid}`;
  }

  async revogar(sid: string, segundos: number): Promise<void> {
    try {
      await this.redis.set(this.chave(sid), '1', 'EX', segundos);
    } catch (erro) {
      // A sessão já foi apagada no banco; o fallback do guard cobre a falha do Redis.
      this.logger.warn(`Redis indisponível ao revogar sessão: ${String(erro)}`);
    }
  }

  async estaRevogada(sid: string): Promise<boolean> {
    try {
      return (await this.redis.exists(this.chave(sid))) === 1;
    } catch {
      const sessao = await this.prisma.sessao.findUnique({
        where: { id: sid },
        select: { id: true },
      });
      return sessao === null;
    }
  }
}
