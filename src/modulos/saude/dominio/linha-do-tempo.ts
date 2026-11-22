/** Linha do tempo do pet (UC-35). */

export interface ItemLinhaDoTempo {
  data: string;
  tipo: 'VACINACAO' | 'EXAME' | 'TRATAMENTO' | 'EVENTO' | 'ATENDIMENTO';
  titulo: string;
  referenciaId: string;
}

/** CT-35-01: ordem cronológica, e no mesmo instante a ordem dos tipos acima. */
export function ordenarLinhaDoTempo(
  itens: ItemLinhaDoTempo[],
): ItemLinhaDoTempo[] {
  const ordemTipo: ItemLinhaDoTempo['tipo'][] = [
    'VACINACAO',
    'EXAME',
    'TRATAMENTO',
    'ATENDIMENTO',
    'EVENTO',
  ];
  return [...itens].sort(
    (a, b) =>
      a.data.localeCompare(b.data) ||
      ordemTipo.indexOf(a.tipo) - ordemTipo.indexOf(b.tipo),
  );
}
