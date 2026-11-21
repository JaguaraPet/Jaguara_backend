/** Assinatura do plano PANTERA (ADR-010, GES-09). Datas AAAA-MM-DD. */

/** Preço de referência enquanto a QA-02 não fecha o valor final (GES-09: R$ 9,90 a 19,90). */
export const PRECO_PADRAO_PANTERA = 14.9;

/** Fim do período de um mês: mesmo dia do mês seguinte, ou o último dia se ele não existir. */
export function fimDoPeriodo(inicio: string): string {
  const [ano, mes, dia] = inicio.split('-').map(Number);
  const proximoMes = mes === 12 ? 1 : mes + 1;
  const anoFim = mes === 12 ? ano + 1 : ano;
  const ultimoDia = new Date(Date.UTC(anoFim, proximoMes, 0)).getUTCDate();
  const d = Math.min(dia, ultimoDia);
  return `${anoFim}-${String(proximoMes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Renovação antecipada: se ainda há período pago, o novo começa no dia seguinte ao fim do
 * atual; senão, começa hoje.
 */
export function inicioDoNovoPeriodo(
  hoje: string,
  fimAtual: string | null,
): string {
  if (!fimAtual || fimAtual < hoje) return hoje;
  const d = new Date(`${fimAtual}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
