/** Horários dos lembretes automáticos (RN18, RN37), sempre no fuso de Brasília. */

const FUSO = '-03:00';
const HORA_PADRAO = '09:00';

/** Data AAAA-MM-DD de hoje em Brasília. */
export function hojeBrasilia(agora: Date = new Date()): string {
  return agora.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

/** Instante de uma data e hora de Brasília. */
export function instanteBrasilia(data: string, hora = HORA_PADRAO): Date {
  return new Date(`${data}T${hora}:00${FUSO}`);
}

/** Soma dias a uma data AAAA-MM-DD. */
export function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Limite de lembretes por tratamento, para tratamentos longos ou sem data de fim. */
export const MAXIMO_DOSES = 120;
/** Sem data de fim, os lembretes cobrem os próximos 30 dias. */
export const DIAS_SEM_FIM = 30;

/**
 * Horários das doses de um tratamento (RN18, CT-14-01): da primeira dose, de tantas em tantas
 * horas, até o fim do último dia, só os que ainda não passaram.
 */
export function horariosDasDoses(t: {
  dataInicio: string;
  dataFim?: string;
  horaPrimeiraDose?: string;
  intervaloHoras: number;
  agora: Date;
}): Date[] {
  const primeira = instanteBrasilia(
    t.dataInicio,
    t.horaPrimeiraDose ?? '08:00',
  );
  const fim = t.dataFim
    ? instanteBrasilia(somarDias(t.dataFim, 1), '00:00')
    : new Date(
        Math.max(primeira.getTime(), t.agora.getTime()) +
          DIAS_SEM_FIM * 86_400_000,
      );
  const passo = t.intervaloHoras * 3_600_000;
  const doses: Date[] = [];
  for (
    let instante = primeira.getTime();
    instante < fim.getTime() && doses.length < MAXIMO_DOSES;
    instante += passo
  ) {
    if (instante > t.agora.getTime()) doses.push(new Date(instante));
  }
  return doses;
}

/** dd/mm/aaaa de uma data AAAA-MM-DD. */
export function dataBrasileira(data: string): string {
  const [ano, mes, dia] = data.split('-');
  return `${dia}/${mes}/${ano}`;
}
