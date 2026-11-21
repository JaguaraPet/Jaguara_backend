/** Controle alimentar do pet (UC-08, RN12). Quantidades em gramas. */

export interface PlanoDoDia {
  metaDiariaGramas: number;
  limiteDiarioGramas: number | null;
}

export interface ResumoDoDia {
  consumoDoDia: number;
  metaDiariaGramas?: number;
  limiteDiarioGramas?: number;
  /** Percentual da meta já consumido, arredondado. */
  percentualMeta?: number;
  limiteExcedido: boolean;
}

/** Soma em centigramas para não acumular erro de ponto flutuante. */
export function somarGramas(quantidades: number[]): number {
  return quantidades.reduce((s, q) => s + Math.round(q * 100), 0) / 100;
}

/** CT-08-01 e CT-08-02: consumo do dia e alerta quando passa do limite (RN12). */
export function resumoDoDia(
  quantidades: number[],
  plano: PlanoDoDia | null,
): ResumoDoDia {
  const consumoDoDia = somarGramas(quantidades);
  if (!plano) return { consumoDoDia, limiteExcedido: false };
  return {
    consumoDoDia,
    metaDiariaGramas: plano.metaDiariaGramas,
    limiteDiarioGramas: plano.limiteDiarioGramas ?? undefined,
    percentualMeta:
      plano.metaDiariaGramas > 0
        ? Math.round((consumoDoDia / plano.metaDiariaGramas) * 100)
        : undefined,
    limiteExcedido:
      plano.limiteDiarioGramas !== null &&
      consumoDoDia > plano.limiteDiarioGramas,
  };
}

/** O limite, quando existe, não pode ficar abaixo da meta. */
export function validarPlano(p: {
  metaDiariaGramas: number;
  limiteDiarioGramas?: number;
  refeicoesPorDia: number;
}): { campo: string; mensagem: string } | null {
  if (!(p.metaDiariaGramas > 0)) {
    return {
      campo: 'metaDiariaGramas',
      mensagem: 'Informe a meta diária em gramas.',
    };
  }
  if (
    p.limiteDiarioGramas !== undefined &&
    p.limiteDiarioGramas < p.metaDiariaGramas
  ) {
    return {
      campo: 'limiteDiarioGramas',
      mensagem: 'O limite não pode ser menor que a meta.',
    };
  }
  if (
    !Number.isInteger(p.refeicoesPorDia) ||
    p.refeicoesPorDia < 1 ||
    p.refeicoesPorDia > 12
  ) {
    return {
      campo: 'refeicoesPorDia',
      mensagem: 'Informe de 1 a 12 refeições por dia.',
    };
  }
  return null;
}

/** Início e fim do dia de Brasília que contém o instante. */
export function diaDeBrasilia(instante: Date): {
  data: string;
  inicio: Date;
  fim: Date;
} {
  const data = instante.toLocaleDateString('sv-SE', {
    timeZone: 'America/Sao_Paulo',
  });
  const inicio = new Date(`${data}T00:00:00-03:00`);
  return { data, inicio, fim: new Date(inicio.getTime() + 86_400_000) };
}
