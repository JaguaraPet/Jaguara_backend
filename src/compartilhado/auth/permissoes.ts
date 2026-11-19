import { SetMetadata } from '@nestjs/common';
import type { CodigoPermissao } from '../../modulos/acesso/dominio/catalogo-permissoes';
import type { TipoUsuario } from './usuario-autenticado';

export const CHAVE_PERMISSOES = 'permissoesExigidas';
export const CHAVE_AUTENTICADO = 'somenteAutenticado';
export const CHAVE_TIPOS = 'tiposPermitidos';

/**
 * Permissões exigidas pela rota (RBAC, ADR-009). O usuário precisa ter todas.
 * Toda rota sem `@Permissoes(...)`, `@Autenticado()` ou `@Publica()` é negada (ADR-012).
 */
export const Permissoes = (...codigos: CodigoPermissao[]) =>
  SetMetadata(CHAVE_PERMISSOES, codigos);

/** Rota que só exige login, sem permissão específica (por exemplo, logout e dados da própria conta). */
export const Autenticado = () => SetMetadata(CHAVE_AUTENTICADO, true);

/**
 * Restringe a rota a tipos de usuário (ADR-002): rotas do app são do tutor, rotas da web
 * Enterprise são da empresa e dos funcionários, e rotas /admin são do administrador.
 */
export const SomenteTipos = (...tipos: TipoUsuario[]) =>
  SetMetadata(CHAVE_TIPOS, tipos);

export const SomenteTutor = () => SomenteTipos('TUTOR');
export const SomenteEnterprise = () => SomenteTipos('EMPRESA', 'FUNCIONARIO');
export const SomenteAdministrador = () => SomenteTipos('ADMINISTRADOR');
