/** Prazo para avaliar depois do atendimento. */
export const DIAS_PARA_AVALIAR = 30;

export interface ResumoAvaliacoes {
  media: number | null;
  total: number;
  /** Quantas avaliações em cada nota, da nota 1 à 5. */
  distribuicao: [number, number, number, number, number];
}

export function notaValida(nota: number): boolean {
  return Number.isInteger(nota) && nota >= 1 && nota <= 5;
}

export function dentroDoPrazo(realizadoEm: Date, agora: Date): boolean {
  return (
    agora.getTime() - realizadoEm.getTime() <= DIAS_PARA_AVALIAR * 86_400_000
  );
}

/** Média com uma casa decimal; sem avaliações, a média fica nula. */
export function resumir(notas: number[]): ResumoAvaliacoes {
  const distribuicao: ResumoAvaliacoes['distribuicao'] = [0, 0, 0, 0, 0];
  for (const n of notas) if (notaValida(n)) distribuicao[n - 1]++;
  const total = distribuicao.reduce((a, b) => a + b, 0);
  const soma = distribuicao.reduce((a, q, i) => a + q * (i + 1), 0);
  return {
    media: total ? Math.round((soma / total) * 10) / 10 : null,
    total,
    distribuicao,
  };
}

/** Na página pública aparece só o primeiro nome de quem avaliou. */
export function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? '';
}
