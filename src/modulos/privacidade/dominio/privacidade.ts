import { createHash } from 'node:crypto';

/** Privacidade e direitos do titular (UC-46, RN25, RN42, LGPD art. 18). */

export type TipoTermo =
  | 'TERMOS_USO_APP'
  | 'TERMOS_ENTERPRISE'
  | 'POLITICA_PRIVACIDADE'
  | 'CONSENTIMENTO_CLIENTE'
  | 'COMUNICACAO_MARKETING';

export type TipoUsuario = 'TUTOR' | 'EMPRESA' | 'FUNCIONARIO' | 'ADMINISTRADOR';

/** Termos que cada tipo de conta aceita (o consentimento de cliente é da empresa, RN41). */
export function termosDaConta(tipo: TipoUsuario): TipoTermo[] {
  if (tipo === 'TUTOR')
    return ['TERMOS_USO_APP', 'POLITICA_PRIVACIDADE', 'COMUNICACAO_MARKETING'];
  if (tipo === 'EMPRESA' || tipo === 'FUNCIONARIO')
    return [
      'TERMOS_ENTERPRISE',
      'POLITICA_PRIVACIDADE',
      'COMUNICACAO_MARKETING',
    ];
  return ['POLITICA_PRIVACIDADE'];
}

/** Situação do aceite de uma versão vigente: o último registro, se não foi revogado. */
export function aceiteVigente(
  registros: {
    aceito: boolean;
    dataAceite: Date;
    dataRevogacao: Date | null;
  }[],
): { aceito: boolean; dataAceite?: Date } {
  const ultimo = [...registros].sort(
    (a, b) => b.dataAceite.getTime() - a.dataAceite.getTime(),
  )[0];
  if (!ultimo || !ultimo.aceito || ultimo.dataRevogacao)
    return { aceito: false };
  return { aceito: true, dataAceite: ultimo.dataAceite };
}

/** E-mail e identificadores que substituem os dados de quem pediu a exclusão. */
export function emailAnonimo(usuarioId: string): string {
  return `excluido-${usuarioId}@anonimo.jaguara`;
}

export function hashAnonimo(usuarioId: string): string {
  return createHash('sha256').update(`excluido:${usuarioId}`).digest('hex');
}
