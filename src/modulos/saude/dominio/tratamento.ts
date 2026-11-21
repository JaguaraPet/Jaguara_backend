/** Tratamento medicamentoso (UC-14, RN18). Datas no formato AAAA-MM-DD. */

export interface ErroTratamento {
  campo: 'dataFim' | 'intervaloHoras' | 'horaPrimeiraDose';
  mensagem: string;
}

/** Intervalo entre 1 hora e 30 dias (doses semanais ou mensais cabem). */
export const INTERVALO_MAXIMO_HORAS = 30 * 24;

export function validarTratamento(
  t: {
    intervaloHoras: number;
    dataInicio: string;
    dataFim?: string;
    horaPrimeiraDose?: string;
  },
  hoje: string,
): ErroTratamento | null {
  if (
    !Number.isInteger(t.intervaloHoras) ||
    t.intervaloHoras < 1 ||
    t.intervaloHoras > INTERVALO_MAXIMO_HORAS
  ) {
    return {
      campo: 'intervaloHoras',
      mensagem: 'Informe o intervalo entre as doses, em horas (1 a 720).',
    };
  }
  if (t.dataFim && t.dataFim < t.dataInicio) {
    return {
      campo: 'dataFim',
      mensagem: 'O fim precisa ser no dia do início ou depois.',
    };
  }
  if (t.dataFim && t.dataFim < hoje) {
    return {
      campo: 'dataFim',
      mensagem: 'Este tratamento já terminou. Informe um fim a partir de hoje.',
    };
  }
  if (
    t.horaPrimeiraDose &&
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(t.horaPrimeiraDose)
  ) {
    return {
      campo: 'horaPrimeiraDose',
      mensagem: 'Informe a hora no formato HH:MM.',
    };
  }
  return null;
}
