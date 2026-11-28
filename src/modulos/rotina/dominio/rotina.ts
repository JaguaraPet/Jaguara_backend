/** Criador de rotinas do tutor: quando cada rotina acontece e os modelos prontos. */

export type TipoRotina =
  | 'PASSEIO'
  | 'BANHO'
  | 'ANTIPULGAS'
  | 'VERMIFUGO'
  | 'ESCOVACAO'
  | 'AREIA'
  | 'ALIMENTACAO'
  | 'OUTRO';

export type FrequenciaRotina =
  'DIARIA' | 'SEMANAL' | 'MENSAL' | 'INTERVALO_DIAS';

export interface RegraRotina {
  frequencia: FrequenciaRotina;
  intervaloDias?: number | null;
  /** 0 = domingo ... 6 = sábado */
  diasSemana: number[];
  /** Data de início, AAAA-MM-DD */
  dataInicio: string;
}

const DIA_MS = 86_400_000;
const dia = (data: string) => new Date(`${data}T12:00:00Z`);

/** A rotina acontece nesta data (AAAA-MM-DD)? */
export function ocorreEm(regra: RegraRotina, data: string): boolean {
  if (data < regra.dataInicio) return false;
  const alvo = dia(data);
  switch (regra.frequencia) {
    case 'DIARIA':
      return true;
    case 'SEMANAL':
      return regra.diasSemana.includes(alvo.getUTCDay());
    case 'MENSAL': {
      const inicio = dia(regra.dataInicio);
      const ultimoDoMes = new Date(
        Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0),
      ).getUTCDate();
      // Começou no dia 31: nos meses mais curtos, vale o último dia do mês.
      return alvo.getUTCDate() === Math.min(inicio.getUTCDate(), ultimoDoMes);
    }
    case 'INTERVALO_DIAS': {
      const n = Math.max(1, regra.intervaloDias ?? 1);
      const dias = Math.round(
        (alvo.getTime() - dia(regra.dataInicio).getTime()) / DIA_MS,
      );
      return dias % n === 0;
    }
  }
}

/** Próximas datas (a partir de `de`, inclusive) em que a rotina acontece, até `limite` datas. */
export function proximasDatas(
  regra: RegraRotina,
  de: string,
  dias: number,
  limite = 60,
): string[] {
  const datas: string[] = [];
  for (let i = 0; i < dias && datas.length < limite; i++) {
    const d = new Date(dia(de).getTime() + i * DIA_MS)
      .toISOString()
      .slice(0, 10);
    if (ocorreEm(regra, d)) datas.push(d);
  }
  return datas;
}

/** "07:00" válido? */
export function horarioValido(h: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(h);
}

export interface ModeloRotina {
  tipo: TipoRotina;
  titulo: string;
  frequencia: FrequenciaRotina;
  intervaloDias?: number;
  diasSemana?: number[];
  horarios: string[];
  /** Explica o modelo sem dizer o que o pet "deve" fazer: o app não dá recomendação veterinária. */
  descricao: string;
}

/**
 * Modelos prontos e editáveis. São atalhos para montar a rotina, não orientação: a frequência
 * certa de antipulgas ou vermífugo é a que o veterinário do pet indicar.
 */
export const MODELOS_ROTINA: ModeloRotina[] = [
  {
    tipo: 'PASSEIO',
    titulo: 'Passeio',
    frequencia: 'DIARIA',
    horarios: ['07:00', '19:00'],
    descricao: 'Todo dia, nos horários que você escolher.',
  },
  {
    tipo: 'ALIMENTACAO',
    titulo: 'Comida',
    frequencia: 'DIARIA',
    horarios: ['08:00', '18:00'],
    descricao: 'As refeições do dia, para a família saber se o pet já comeu.',
  },
  {
    tipo: 'BANHO',
    titulo: 'Banho',
    frequencia: 'INTERVALO_DIAS',
    intervaloDias: 15,
    horarios: [],
    descricao: 'A cada tantos dias. Ajuste ao que combina com o seu pet.',
  },
  {
    tipo: 'ANTIPULGAS',
    titulo: 'Antipulgas',
    frequencia: 'MENSAL',
    horarios: ['09:00'],
    descricao: 'Uma vez por mês, ou no intervalo que o veterinário indicar.',
  },
  {
    tipo: 'VERMIFUGO',
    titulo: 'Vermífugo',
    frequencia: 'INTERVALO_DIAS',
    intervaloDias: 90,
    horarios: ['09:00'],
    descricao: 'No intervalo que o veterinário indicar.',
  },
  {
    tipo: 'ESCOVACAO',
    titulo: 'Escovar os dentes',
    frequencia: 'SEMANAL',
    diasSemana: [1, 3, 5],
    horarios: ['21:00'],
    descricao: 'Nos dias da semana que você escolher.',
  },
  {
    tipo: 'AREIA',
    titulo: 'Trocar a areia',
    frequencia: 'DIARIA',
    horarios: ['08:00'],
    descricao: 'Todo dia, no horário que você escolher.',
  },
];
