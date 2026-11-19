import { Erros } from '../erros/erro-negocio';
import type { UsuarioAutenticado } from './usuario-autenticado';

/**
 * Empresa e funcionários só acessam dados da própria empresa (ADR-002, RN24).
 * O administrador da plataforma pode consultar qualquer empresa.
 */
export function garantirMesmaEmpresa(
  usuario: UsuarioAutenticado,
  empresaId: string,
): void {
  if (usuario.tipo === 'ADMINISTRADOR') return;
  if (usuario.empresaId !== empresaId) {
    throw Erros.semPermissao('Você só acessa dados da sua empresa.');
  }
}

/** Empresa do usuário Enterprise logado; falha para tutores e administradores. */
export function empresaDoUsuario(usuario: UsuarioAutenticado): string {
  if (!usuario.empresaId) {
    throw Erros.semPermissao('Esta área é exclusiva de empresas.');
  }
  return usuario.empresaId;
}
