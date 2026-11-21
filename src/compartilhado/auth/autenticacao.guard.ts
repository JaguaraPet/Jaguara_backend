import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { Erros } from '../erros/erro-negocio';
import { SessoesRevogadas } from './sessoes-revogadas';
import { CHAVE_PUBLICA, UsuarioAutenticado } from './usuario-autenticado';

/**
 * Guard global (APP_GUARD) da camada de acesso (ADR-012, passos 2 e 3): valida assinatura
 * e validade do access token sem consultar o banco e recusa sessões revogadas.
 */
@Injectable()
export class AutenticacaoGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly revogadas: SessoesRevogadas,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    // O WebSocket valida o token na conexão (ChatGateway, ADR-011).
    if (contexto.getType() !== 'http') return true;
    const publica = this.reflector.getAllAndOverride<boolean>(CHAVE_PUBLICA, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (publica) return true;

    const requisicao = contexto
      .switchToHttp()
      .getRequest<Request & { usuario?: UsuarioAutenticado }>();
    const [tipo, token] = requisicao.headers.authorization?.split(' ') ?? [];
    if (tipo !== 'Bearer' || !token) {
      throw Erros.naoAutenticado(
        'Envie o access token no cabeçalho Authorization.',
      );
    }

    let usuario: UsuarioAutenticado;
    try {
      usuario = await this.jwt.verifyAsync<UsuarioAutenticado>(token);
    } catch {
      throw Erros.naoAutenticado('Access token inválido ou expirado.');
    }
    if (await this.revogadas.estaRevogada(usuario.sid)) {
      throw Erros.naoAutenticado('Sessão encerrada.');
    }
    requisicao.usuario = usuario;
    return true;
  }
}
