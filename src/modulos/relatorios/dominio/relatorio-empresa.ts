/** Relatórios operacional e gerencial da empresa (UC-18, RN22). */

export type TipoRelatorioEmpresa = 'atendimentos' | 'financeiro';

/** Permissões exigidas por tipo: o gerencial mostra valores e pede também financeiro:ler. */
export const PERMISSOES_DO_TIPO: Record<TipoRelatorioEmpresa, string[]> = {
  atendimentos: ['relatorio:ler'],
  financeiro: ['relatorio:ler', 'financeiro:ler'],
};

export function permissoesFaltando(
  tipo: TipoRelatorioEmpresa,
  permissoes: string[],
): string[] {
  return PERMISSOES_DO_TIPO[tipo].filter((p) => !permissoes.includes(p));
}

export interface Contagem {
  chave: string;
  quantidade: number;
  total?: number;
}

/** Agrupa por chave, da maior quantidade (ou valor) para a menor; soma em centavos. */
export function agrupar<T>(
  itens: T[],
  chave: (i: T) => string,
  valor?: (i: T) => number,
): Contagem[] {
  const mapa = new Map<string, { quantidade: number; centavos: number }>();
  for (const item of itens) {
    const k = chave(item);
    const atual = mapa.get(k) ?? { quantidade: 0, centavos: 0 };
    mapa.set(k, {
      quantidade: atual.quantidade + 1,
      centavos: atual.centavos + (valor ? Math.round(valor(item) * 100) : 0),
    });
  }
  return [...mapa.entries()]
    .map(([k, v]) => ({
      chave: k,
      quantidade: v.quantidade,
      ...(valor ? { total: v.centavos / 100 } : {}),
    }))
    .sort(
      (a, b) =>
        (b.total ?? 0) - (a.total ?? 0) ||
        b.quantidade - a.quantidade ||
        a.chave.localeCompare(b.chave),
    );
}

/** Percentual com uma casa, ou 0 quando não há base. */
export const percentual = (parte: number, todo: number) =>
  todo === 0 ? 0 : Math.round((parte / todo) * 1000) / 10;
