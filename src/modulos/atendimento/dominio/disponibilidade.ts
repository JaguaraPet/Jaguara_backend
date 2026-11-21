/**
 * Horários disponíveis de um serviço (UC-40, RN40, RN14, RN29), sem dependência de framework.
 *
 * Um horário está livre quando pelo menos um profissional ou recurso da empresa atua naquele
 * intervalo inteiro e não tem agendamento ativo que se cruze com ele.
 */

/** Fuso das empresas (padrão do ARQ-01). O Brasil não tem horário de verão desde 2019. */
export const DESLOCAMENTO_BRASILIA_MIN = -3 * 60;

/** Intervalo entre os horários oferecidos. */
export const PASSO_MINUTOS = 30;

export interface Janela {
  donoId: string;
  inicioMin: number;
  fimMin: number;
}

export interface Ocupacao {
  donoId: string;
  inicio: Date;
  fim: Date;
}

/** Meia-noite do dia (AAAA-MM-DD) em Brasília, como instante UTC. */
export function inicioDoDiaBrasilia(data: string): Date {
  const [a, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d) - DESLOCAMENTO_BRASILIA_MIN * 60_000);
}

/** Dia da semana (0 = domingo) da data em Brasília. */
export function diaDaSemana(data: string): number {
  const [a, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

export function horariosDisponiveis(params: {
  data: string;
  duracaoMinutos: number;
  janelas: Janela[];
  ocupacoes: Ocupacao[];
  agora: Date;
}): Date[] {
  const meiaNoite = inicioDoDiaBrasilia(params.data).getTime();
  const livres = new Set<number>();
  for (const janela of params.janelas) {
    for (
      let inicio = janela.inicioMin;
      inicio + params.duracaoMinutos <= janela.fimMin;
      inicio += PASSO_MINUTOS
    ) {
      const de = meiaNoite + inicio * 60_000;
      const ate = de + params.duracaoMinutos * 60_000;
      if (de <= params.agora.getTime()) continue;
      const ocupado = params.ocupacoes.some(
        (o) =>
          o.donoId === janela.donoId &&
          o.inicio.getTime() < ate &&
          de < o.fim.getTime(),
      );
      if (!ocupado) livres.add(de);
    }
  }
  return [...livres].sort((a, b) => a - b).map((t) => new Date(t));
}
