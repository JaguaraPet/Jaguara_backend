/** Regras do pet (UC-04), sem dependência de framework. */

/** Idade em anos completos na data de referência (atributo derivado /idade do MOD-01). */
export function idadeEmAnos(
  nascimento: Date | null,
  hoje: Date,
): number | undefined {
  if (!nascimento) return undefined;
  let anos = hoje.getUTCFullYear() - nascimento.getUTCFullYear();
  const aniversarioAindaNaoChegou =
    hoje.getUTCMonth() < nascimento.getUTCMonth() ||
    (hoje.getUTCMonth() === nascimento.getUTCMonth() &&
      hoje.getUTCDate() < nascimento.getUTCDate());
  if (aniversarioAindaNaoChegou) anos -= 1;
  return Math.max(anos, 0);
}

/** RN08: pet com histórico clínico ou financeiro não é excluído, só arquivado. */
export function podeExcluirPet(historico: {
  registrosClinicos: number;
  despesas: number;
  agendamentos: number;
}): boolean {
  return (
    historico.registrosClinicos === 0 &&
    historico.despesas === 0 &&
    historico.agendamentos === 0
  );
}

export type NivelAcessoPet =
  'RESPONSAVEL_PRINCIPAL' | 'RESPONSAVEL' | 'EMPRESA' | 'NENHUM';
