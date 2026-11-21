/** Horários de atuação (UC-24, RN29), sem dependência de framework. */

export type DiaSemana =
  'SEGUNDA' | 'TERCA' | 'QUARTA' | 'QUINTA' | 'SEXTA' | 'SABADO' | 'DOMINGO';

/** Dia da semana do enum na ordem do Date.getDay() (domingo = 0). */
export const DIAS: DiaSemana[] = [
  'DOMINGO',
  'SEGUNDA',
  'TERCA',
  'QUARTA',
  'QUINTA',
  'SEXTA',
  'SABADO',
];

/** "08:30" -> minutos desde a meia-noite. */
export function minutos(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Minutos -> "08:30". */
export function hora(totalMinutos: number): string {
  const h = Math.floor(totalMinutos / 60);
  const m = totalMinutos % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Hora válida de 00:00 a 23:59. */
export function horaValida(hhmm: string): boolean {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  return match !== null;
}

/** Dois intervalos [inicio, fim) se cruzam. */
export function sobrepoe(
  a: { inicio: number; fim: number },
  b: { inicio: number; fim: number },
): boolean {
  return a.inicio < b.fim && b.inicio < a.fim;
}
