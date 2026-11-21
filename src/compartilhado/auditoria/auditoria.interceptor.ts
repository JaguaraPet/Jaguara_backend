import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import type { UsuarioAutenticado } from '../auth/usuario-autenticado';
import { AuditoriaService, NivelLog } from './auditoria.service';

export const CHAVE_AUDITAR = 'auditar';

interface ConfigAuditoria {
  acao: string;
  entidade: string;
  nivel: NivelLog;
  /** Parâmetro da rota com o identificador; sem ele, usa o `id` da resposta. */
  parametro?: string;
}

/** Marca a rota para gravar `LogAuditoria` depois que ela termina com sucesso (RN31). */
export const Auditar = (config: ConfigAuditoria) =>
  SetMetadata(CHAVE_AUDITAR, config);

/** Interceptor global da camada de acesso (ADR-012, passo 6). */
@Injectable()
export class AuditoriaInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditoria: AuditoriaService,
  ) {}

  intercept(
    contexto: ExecutionContext,
    proximo: CallHandler,
  ): Observable<unknown> {
    const config = this.reflector.get<ConfigAuditoria | undefined>(
      CHAVE_AUDITAR,
      contexto.getHandler(),
    );
    if (!config) return proximo.handle();
    const requisicao = contexto
      .switchToHttp()
      .getRequest<Request & { usuario?: UsuarioAutenticado }>();
    return proximo.handle().pipe(
      tap((resposta) => {
        const id =
          (config.parametro
            ? requisicao.params[config.parametro]
            : undefined) ??
          (resposta as { id?: string } | undefined)?.id ??
          '-';
        // Sem await: a auditoria não atrasa a resposta.
        void this.auditoria.registrar({
          acao: config.acao,
          entidade: config.entidade,
          entidadeId: String(id),
          nivel: config.nivel,
          autorId: requisicao.usuario?.sub,
          ip: requisicao.ip,
        });
      }),
    );
  }
}
