import type { NivelAcessoPet } from '../../pet/dominio/pet';

/** Partes da saúde do pet que o tutor compartilha separadamente (RN15). */
export type EscopoSaude = 'VACINAS' | 'EXAMES' | 'MEDICAMENTOS' | 'ALERGIAS';
export type ModoAcesso = 'ler' | 'editar';

/**
 * Regra de acesso à saúde do pet (RN15, RN26, RN30):
 * - tutor responsável: `saude:ler` para ler e `saude:editar` para registrar;
 * - empresa: `atendimento:ler`/`atendimento:editar` e o escopo compartilhado; registrar exige
 *   também EDICAO_CLINICA; pet de cliente sem conta da própria empresa dispensa o escopo.
 */
export function podeAcessarSaude(a: {
  nivel: NivelAcessoPet;
  permissoes: string[];
  escopos: string[];
  clienteSemConta: boolean;
  escopo: EscopoSaude;
  modo: ModoAcesso;
}): boolean {
  if (a.nivel === 'RESPONSAVEL_PRINCIPAL' || a.nivel === 'RESPONSAVEL') {
    return a.permissoes.includes(`saude:${a.modo}`);
  }
  if (a.nivel !== 'EMPRESA') return false;
  if (!a.permissoes.includes(`atendimento:${a.modo}`)) return false;
  if (a.clienteSemConta) return true;
  if (!a.escopos.includes(a.escopo)) return false;
  return a.modo === 'ler' || a.escopos.includes('EDICAO_CLINICA');
}
