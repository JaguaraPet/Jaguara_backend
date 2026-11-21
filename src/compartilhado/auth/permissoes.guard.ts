import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Erros } from '../erros/erro-negocio';
import { CHAVE_AUTENTICADO, CHAVE_PERMISSOES, CHAVE_TIPOS } from './permissoes';
import {
  CHAVE_PUBLICA,
  TipoUsuario,
  UsuarioAutenticado,
} from './usuario-autenticado';

/**
 * Segundo guard global da camada de acesso (ADR-012, passo 4). Compara o tipo de usuário e as
 * permissões exigidas pela rota com as que vieram no access token, sem consultar o banco.
 * Nega por padrão: rota sem marcação não responde.
 */
@Injectable()
export class PermissoesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(contexto: ExecutionContext): boolean {
    // O WebSocket confere token e permissão chat:usar na conexão (ChatGateway, ADR-011).
    if (contexto.getType() !== 'http') return true;
    const alvos = [contexto.getHandler(), contexto.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(CHAVE_PUBLICA, alvos)) {
      return true;
    }

    const usuario = contexto
      .switchToHttp()
      .getRequest<{ usuario?: UsuarioAutenticado }>().usuario;
    if (!usuario) throw Erros.naoAutenticado();

    const tipos = this.reflector.getAllAndOverride<TipoUsuario[] | undefined>(
      CHAVE_TIPOS,
      alvos,
    );
    if (tipos && !tipos.includes(usuario.tipo)) {
      throw Erros.semPermissao('Esta área não é do seu tipo de conta.');
    }

    const exigidas = this.reflector.getAllAndOverride<string[] | undefined>(
      CHAVE_PERMISSOES,
      alvos,
    );
    if (exigidas) {
      const faltando = exigidas.filter((p) => !usuario.permissoes.includes(p));
      if (faltando.length > 0) {
        throw Erros.semPermissao(
          `Seu perfil não tem a permissão ${faltando.join(', ')}.`,
        );
      }
      return true;
    }

    if (this.reflector.getAllAndOverride<boolean>(CHAVE_AUTENTICADO, alvos)) {
      return true;
    }
    // Negar por padrão (ADR-012): a rota esqueceu de declarar o acesso.
    throw Erros.semPermissao('Rota sem regra de acesso declarada.');
  }
}
