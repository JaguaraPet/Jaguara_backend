import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Limite por IP só nas rotas HTTP (ADR-012, passo 1); o WebSocket tem conexão própria. */
@Injectable()
export class LimiteRequisicoesGuard extends ThrottlerGuard {
  protected async shouldSkip(contexto: ExecutionContext): Promise<boolean> {
    return contexto.getType() !== 'http' || super.shouldSkip(contexto);
  }
}
