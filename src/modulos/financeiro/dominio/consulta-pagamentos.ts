/** Consulta de pagamentos e reembolso (UC-45, RN39). */

/** Prazo para pedir reembolso depois da confirmação. */
export const DIAS_PARA_REEMBOLSO = 30;

/**
 * Motivo para não aceitar o reembolso, ou null se pode. Só pagamento aceito, sem outro pedido
 * em aberto ou aprovado, e dentro do prazo. CT-45-02.
 */
export function motivoSemReembolso(
  p: {
    status: string;
    dataConfirmacao: Date | null;
    reembolsos: { status: string }[];
  },
  agora: Date,
): string | null {
  if (p.status !== 'ACEITO' || !p.dataConfirmacao) {
    return 'Só dá para pedir reembolso de pagamento confirmado.';
  }
  if (
    p.reembolsos.some(
      (r) => r.status === 'EM_ANALISE' || r.status === 'APROVADO',
    )
  ) {
    return 'Já existe um pedido de reembolso para este pagamento.';
  }
  const limite = p.dataConfirmacao.getTime() + DIAS_PARA_REEMBOLSO * 86_400_000;
  if (agora.getTime() > limite) {
    return `O prazo de ${DIAS_PARA_REEMBOLSO} dias para pedir reembolso terminou.`;
  }
  return null;
}

/** Período de AAAA-MM-DD a AAAA-MM-DD em Brasília, com o fim inclusivo. */
export function intervaloDoFiltro(de?: string, ate?: string) {
  if (!de && !ate) return undefined;
  return {
    ...(de ? { gte: new Date(`${de}T00:00:00-03:00`) } : {}),
    ...(ate
      ? {
          lt: new Date(
            new Date(`${ate}T00:00:00-03:00`).getTime() + 86_400_000,
          ),
        }
      : {}),
  };
}
