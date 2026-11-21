/** Compartilhamento do perfil do pet (UC-11, RN15). */

export type Escopo =
  | 'PERFIL_BASICO'
  | 'VACINAS'
  | 'EXAMES'
  | 'MEDICAMENTOS'
  | 'ALERGIAS'
  | 'DOCUMENTOS'
  | 'LINHA_DO_TEMPO'
  | 'EDICAO_CLINICA';

/** Seções que o link público mostra e o escopo que cada uma exige. */
export const SECOES = {
  vacinas: 'VACINAS',
  exames: 'EXAMES',
  medicamentos: 'MEDICAMENTOS',
  alergias: 'ALERGIAS',
} as const satisfies Record<string, Escopo>;

export type Secao = keyof typeof SECOES;

export const ROTULO_ESCOPO: Record<Escopo, string> = {
  PERFIL_BASICO: 'perfil básico',
  VACINAS: 'vacinas',
  EXAMES: 'exames',
  MEDICAMENTOS: 'medicamentos',
  ALERGIAS: 'alergias e restrições',
  DOCUMENTOS: 'documentos',
  LINHA_DO_TEMPO: 'linha do tempo',
  EDICAO_CLINICA: 'registro de informações clínicas',
};

export type SituacaoLink = 'ATIVO' | 'REVOGADO' | 'EXPIRADO';

/** O link vale enquanto ativo e antes da data de expiração. */
export function situacao(
  c: { status: SituacaoLink; dataExpiracao: Date | null },
  agora: Date,
): SituacaoLink {
  if (c.status !== 'ATIVO') return c.status;
  if (c.dataExpiracao && c.dataExpiracao <= agora) return 'EXPIRADO';
  return 'ATIVO';
}

/**
 * Regras do pedido: um destino (empresa ou e-mail, não os dois), escopos sem repetição e
 * expiração futura. A edição clínica só vale para empresas, que registram no sistema.
 */
export function validarCompartilhamento(
  p: {
    empresaId?: string;
    destinatarioEmail?: string;
    escopos: Escopo[];
    dataExpiracao?: string;
  },
  agora: Date,
): { campo: string; mensagem: string } | null {
  if (!!p.empresaId === !!p.destinatarioEmail) {
    return {
      campo: 'empresaId',
      mensagem: 'Compartilhe com uma empresa ou com um e-mail.',
    };
  }
  if (p.destinatarioEmail && p.escopos.includes('EDICAO_CLINICA')) {
    return {
      campo: 'escopos',
      mensagem: 'A edição clínica só pode ser dada a empresas.',
    };
  }
  if (p.dataExpiracao && new Date(p.dataExpiracao) <= agora) {
    return {
      campo: 'dataExpiracao',
      mensagem: 'A expiração precisa ser no futuro.',
    };
  }
  return null;
}
