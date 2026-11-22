/** O que a empresa vê de cada pet vinculado (UC-20, UC-22; RN24, RN26). */

export type MotivoVinculo = 'COMPARTILHAMENTO' | 'AGENDAMENTO' | 'CLIENTE';
export type SecaoPerfil = 'vacinas' | 'exames' | 'medicamentos' | 'alergias';

const ESCOPO_DA_SECAO: Record<SecaoPerfil, string> = {
  vacinas: 'VACINAS',
  exames: 'EXAMES',
  medicamentos: 'MEDICAMENTOS',
  alergias: 'ALERGIAS',
};

/**
 * Seções liberadas: todas para o pet de cliente sem conta da própria empresa (ADR-010); senão,
 * só as do compartilhamento ativo. Agendamento sozinho dá acesso só ao perfil básico.
 */
export function secoesLiberadas(v: {
  escopos: string[];
  clienteSemConta: boolean;
}): SecaoPerfil[] {
  const todas = Object.keys(ESCOPO_DA_SECAO) as SecaoPerfil[];
  if (v.clienteSemConta) return todas;
  return todas.filter((s) => v.escopos.includes(ESCOPO_DA_SECAO[s]));
}

/** Motivos do vínculo, na ordem em que aparecem na tela. */
export function motivosDoVinculo(v: {
  compartilhado: boolean;
  agendado: boolean;
  cliente: boolean;
}): MotivoVinculo[] {
  return [
    ...(v.compartilhado ? ['COMPARTILHAMENTO' as const] : []),
    ...(v.agendado ? ['AGENDAMENTO' as const] : []),
    ...(v.cliente ? ['CLIENTE' as const] : []),
  ];
}
