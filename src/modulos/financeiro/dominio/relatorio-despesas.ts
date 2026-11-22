/** Relatório de despesas do tutor por período (UC-07, RN11). */

export interface DespesaDoRelatorio {
  descricao: string;
  valor: number;
  data: string;
  categoria: string;
  pet: string;
}

export interface TotalCategoria {
  categoria: string;
  quantidade: number;
  total: number;
}

const centavos = (v: number) => Math.round(v * 100);

/** CT-07-01: total por categoria, da maior para a menor, somando em centavos. */
export function totaisPorCategoria(
  despesas: DespesaDoRelatorio[],
): TotalCategoria[] {
  const mapa = new Map<string, { quantidade: number; centavos: number }>();
  for (const d of despesas) {
    const atual = mapa.get(d.categoria) ?? { quantidade: 0, centavos: 0 };
    mapa.set(d.categoria, {
      quantidade: atual.quantidade + 1,
      centavos: atual.centavos + centavos(d.valor),
    });
  }
  return [...mapa.entries()]
    .map(([categoria, v]) => ({
      categoria,
      quantidade: v.quantidade,
      total: v.centavos / 100,
    }))
    .sort(
      (a, b) => b.total - a.total || a.categoria.localeCompare(b.categoria),
    );
}

export function totalGeral(despesas: DespesaDoRelatorio[]): number {
  return despesas.reduce((soma, d) => soma + centavos(d.valor), 0) / 100;
}

export const reais = (v: number) =>
  `R$ ${v
    .toFixed(2)
    .replace('.', ',')
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;

export const dataBr = (iso: string) => iso.split('-').reverse().join('/');
