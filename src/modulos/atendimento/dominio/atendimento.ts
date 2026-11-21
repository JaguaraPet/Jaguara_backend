/** Registro de atendimento (UC-23, DS-04): itens cobrados e integridade depois de finalizado. */

export interface ItemCobrado {
  servicoId: string;
  quantidade: number;
  valorUnitario: number;
  observacao?: string;
}

/**
 * RN27: o serviço agendado é cobrado pelo preço contratado; serviços extras feitos no mesmo
 * atendimento entram pelo preço atual, já que são contratados naquele momento.
 */
export function valorDoItem(
  item: { servicoId: string },
  agendado: { servicoId: string; precoContratado: number },
  precoAtual: number,
): number {
  return item.servicoId === agendado.servicoId
    ? agendado.precoContratado
    : precoAtual;
}

/** Total do atendimento em centavos inteiros, sem erro de ponto flutuante. */
export function totalDosItens(itens: ItemCobrado[]): number {
  const centavos = itens.reduce(
    (soma, i) => soma + Math.round(i.valorUnitario * 100) * i.quantidade,
    0,
  );
  return centavos / 100;
}

/** O atendimento só é registrado depois que o horário agendado começou (UC-23, passo 1). */
export function jaOcorreu(inicio: Date, agora: Date): boolean {
  return inicio.getTime() <= agora.getTime();
}

/** Diferença entre antes e depois, só com os campos que mudaram, para o log de auditoria (RN28). */
export function alteracoes<T extends Record<string, string | null>>(
  antes: T,
  depois: Partial<T>,
): { campo: string; antes: string | null; depois: string | null }[] {
  return Object.entries(depois)
    .filter(([campo, valor]) => valor !== undefined && valor !== antes[campo])
    .map(([campo, valor]) => ({
      campo,
      antes: antes[campo] ?? null,
      depois: (valor as string | null) ?? null,
    }));
}
