import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';

export type TipoUsuario = 'TUTOR' | 'EMPRESA' | 'FUNCIONARIO' | 'ADMINISTRADOR';

/** Conteúdo do access token (ADR-012, seção 2). */
export interface UsuarioAutenticado {
  sub: string;
  sid: string;
  tipo: TipoUsuario;
  perfil: string;
  empresaId: string | null;
  permissoes: string[];
}

export const CHAVE_PUBLICA = 'rotaPublica';

/** Rota que não exige login. Toda rota sem `@Publica()` exige access token válido (negar por padrão). */
export const Publica = () => SetMetadata(CHAVE_PUBLICA, true);

/** Injeta o usuário do access token no parâmetro do controlador. */
export const UsuarioAtual = createParamDecorator(
  (_dado: unknown, contexto: ExecutionContext): UsuarioAutenticado =>
    contexto.switchToHttp().getRequest<{ usuario: UsuarioAutenticado }>()
      .usuario,
);
