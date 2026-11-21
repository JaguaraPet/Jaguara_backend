/** Programação e reenvio das notificações automáticas (UC-31, RN37, DS-06). */

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

export type Canal = 'PUSH' | 'EMAIL' | 'SMS';

export const TIPOS_EVENTO: TipoEvento[] = [
  'CONSULTA',
  'VACINA',
  'MEDICAMENTO',
  'EXAME',
  'CIRURGIA',
  'BANHO_TOSA',
  'HOSPEDAGEM',
  'COMPROMISSO',
  'OUTRO',
];

/** Antecedência padrão por tipo, em minutos, quando o usuário não configurou (RN37). */
export const ANTECEDENCIA_PADRAO: Record<TipoEvento, number> = {
  CONSULTA: 60,
  VACINA: 24 * 60,
  MEDICAMENTO: 0,
  EXAME: 60,
  CIRURGIA: 24 * 60,
  BANHO_TOSA: 60,
  HOSPEDAGEM: 24 * 60,
  COMPROMISSO: 60,
  OUTRO: 30,
};

/** Antecedência máxima: uma semana. */
export const ANTECEDENCIA_MAXIMA = 7 * 24 * 60;

export interface Configuracao {
  tipoEvento: TipoEvento;
  canal: Canal;
  antecedenciaMinutos: number;
  ativa: boolean;
}

/** Configuração efetiva de um tipo: a do usuário ou a padrão (push, antecedência padrão). */
export function configuracaoEfetiva(
  tipo: TipoEvento,
  doUsuario?: Configuracao,
): Configuracao {
  return (
    doUsuario ?? {
      tipoEvento: tipo,
      canal: 'PUSH',
      antecedenciaMinutos: ANTECEDENCIA_PADRAO[tipo],
      ativa: true,
    }
  );
}

/**
 * CT-31-01: a notificação sai na data de referência menos a antecedência do usuário. Nada é
 * agendado se a configuração está desligada ou se o horário já passou.
 */
export function programar(
  referencia: Date,
  configuracao: Configuracao,
  agora: Date,
): Date | null {
  if (!configuracao.ativa) return null;
  const quando = new Date(
    referencia.getTime() - configuracao.antecedenciaMinutos * 60_000,
  );
  return quando > agora ? quando : null;
}

export const MAXIMO_TENTATIVAS = 5;

/**
 * CT-31-02: depois de uma falha, nova tentativa com espera exponencial (1, 2, 4, 8 minutos);
 * na quinta falha, a notificação fica como FALHOU.
 */
export function aposFalha(
  tentativas: number,
  agora: Date,
): { status: 'AGENDADA'; proxima: Date } | { status: 'FALHOU' } {
  const feitas = tentativas + 1;
  if (feitas >= MAXIMO_TENTATIVAS) return { status: 'FALHOU' };
  return {
    status: 'AGENDADA',
    proxima: new Date(agora.getTime() + 2 ** (feitas - 1) * 60_000),
  };
}
