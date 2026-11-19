import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

/** Identificador de cada requisição para correlacionar os logs (ARQ-01, observabilidade). */
@Injectable()
export class IdRequisicaoMiddleware implements NestMiddleware {
  use(requisicao: Request, resposta: Response, proximo: NextFunction) {
    const recebido = requisicao.header('x-request-id');
    const id =
      recebido && /^[\w-]{8,64}$/.test(recebido) ? recebido : randomUUID();
    requisicao.headers['x-request-id'] = id;
    resposta.setHeader('X-Request-Id', id);
    proximo();
  }
}
