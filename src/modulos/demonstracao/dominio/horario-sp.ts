/** Brasília não tem horário de verão desde 2019: UTC-3 fixo. */
const DESLOCAMENTO_MS = 3 * 60 * 60 * 1000;

/** Data e hora em Brasília, `dias` depois do dia de `agora`, como instante UTC. */
export function emBrasilia(agora: Date, dias: number, hhmm: string): Date {
  const local = new Date(agora.getTime() - DESLOCAMENTO_MS);
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() + dias,
      h,
      m,
    ) + DESLOCAMENTO_MS,
  );
}

/** Só a data (meia-noite UTC), para colunas `date`, `dias` depois do dia de `agora` em Brasília. */
export function dataBrasilia(agora: Date, dias: number): Date {
  const local = new Date(agora.getTime() - DESLOCAMENTO_MS);
  return new Date(
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() + dias,
    ),
  );
}

/** Dia da semana em Brasília (0 = domingo), `dias` depois do dia de `agora`. */
export function diaDaSemanaBrasilia(agora: Date, dias: number): number {
  return dataBrasilia(agora, dias).getUTCDay();
}
