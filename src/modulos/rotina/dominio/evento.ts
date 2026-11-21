/** Calendário do pet (UC-10, RN14, RN37). */

export type TipoEvento =
  | 'CONSULTA'
  | 'VACINA'
  | 'MEDICAMENTO'
  | 'EXAME'
  | 'CIRURGIA'
  | 'BANHO_TOSA'
  | 'HOSPEDAGEM'
  | 'COMPROMISSO'
  | 'OUTRO';

/** Evento sem fim ocupa uma hora na agenda do pet. */
export const DURACAO_PADRAO_MS = 60 * 60_000;

export function fimDoEvento(inicio: Date, fim?: Date | null): Date {
  return fim ?? new Date(inicio.getTime() + DURACAO_PADRAO_MS);
}

/** Dois intervalos se cruzam quando um começa antes de o outro terminar. */
export function cruzam(
  a: { inicio: Date; fim: Date },
  b: { inicio: Date; fim: Date },
): boolean {
  return a.inicio < b.fim && b.inicio < a.fim;
}

/** Tipo do evento a partir da categoria do serviço agendado com uma empresa. */
export function tipoDaCategoria(categoria: string): TipoEvento {
  const mapa: Record<string, TipoEvento> = {
    CONSULTA: 'CONSULTA',
    EXAME: 'EXAME',
    CIRURGIA: 'CIRURGIA',
    VACINACAO: 'VACINA',
    BANHO_TOSA: 'BANHO_TOSA',
    HOSPEDAGEM: 'HOSPEDAGEM',
    CRECHE: 'HOSPEDAGEM',
  };
  return mapa[categoria] ?? 'COMPROMISSO';
}
