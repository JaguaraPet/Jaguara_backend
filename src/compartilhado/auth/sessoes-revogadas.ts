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

  /**
   * Perfil global alterado (UC-29, RN35): tokens emitidos antes deixam de valer e o cliente
   * renova a sessão, que já sai com as permissões novas. Fica pelo tempo de vida do token.
   */
  async marcarPerfilAlterado(perfil: string, segundos: number): Promise<void> {
    try {
      await this.redis.set(
        `jaguara:perfil-alterado:${perfil}`,
        String(Math.floor(Date.now() / 1000)),
        'EX',
        segundos,
      );
    } catch (erro) {
      this.logger.warn(`Redis indisponível ao marcar perfil: ${String(erro)}`);
    }
  }

  /** O token foi emitido antes da última mudança do perfil? Sem Redis, vale o token. */
  async perfilMudouDepois(
    perfil: string,
    emitidoEm?: number,
  ): Promise<boolean> {
    if (!emitidoEm) return false;
    try {
      const marca = await this.redis.get(`jaguara:perfil-alterado:${perfil}`);
      return marca !== null && Number(marca) > emitidoEm;
    } catch {
      return false;
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
