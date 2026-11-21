/** Regras do cliente da empresa (UC-21, RN41, ADR-010), sem dependência de framework. */

/** Pré-cadastro sem aceite do termo é excluído depois deste prazo (RN41). */
export const DIAS_PRE_CADASTRO = 7;

export type SituacaoConsentimento = 'PENDENTE' | 'VIGENTE' | 'REVOGADO';

export interface ConsentimentoRegistrado {
  aceito: boolean;
  dataRevogacao: Date | null;
}

/** Situação a partir do consentimento mais recente do cliente. */
export function situacaoConsentimento(
  consentimento: ConsentimentoRegistrado | null | undefined,
): SituacaoConsentimento {
  if (!consentimento) return 'PENDENTE';
  if (consentimento.dataRevogacao) return 'REVOGADO';
  return consentimento.aceito ? 'VIGENTE' : 'PENDENTE';
}

/** O link do termo vale enquanto o pré-cadastro existe: 7 dias a partir do cadastro (RN41). */
export function preCadastroVencido(cadastradoEm: Date, agora: Date): boolean {
  return (
    agora.getTime() - cadastradoEm.getTime() > DIAS_PRE_CADASTRO * 86_400_000
  );
}

/** Código sequencial do cliente na empresa: CLI-0001, CLI-0002... */
export function codigoCliente(sequencia: number): string {
  return `CLI-${String(sequencia).padStart(4, '0')}`;
}
