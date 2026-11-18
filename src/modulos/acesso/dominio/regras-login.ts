/** Regras de autenticação do UC-02 (RN02, RN03, RN04), sem dependência de framework. */

export const MAX_TENTATIVAS_LOGIN = 5;
export const MINUTOS_BLOQUEIO = 5;

export type StatusConta =
  'PENDENTE_CONFIRMACAO' | 'ATIVA' | 'BLOQUEADA' | 'SUSPENSA' | 'INATIVA';

export interface EstadoLogin {
  status: StatusConta;
  emailConfirmado: boolean;
  tentativasLoginFalhas: number;
  bloqueadoAte: Date | null;
}

export type Impedimento =
  | { motivo: 'BLOQUEIO_TEMPORARIO'; ate: Date }
  | { motivo: 'EMAIL_NAO_CONFIRMADO' }
  | { motivo: 'CONTA_INDISPONIVEL' };

/** Diz se a conta pode tentar entrar agora (antes de conferir a senha). */
export function impedimentoDeLogin(
  conta: EstadoLogin,
  agora: Date,
): Impedimento | null {
  if (conta.bloqueadoAte && conta.bloqueadoAte > agora) {
    return { motivo: 'BLOQUEIO_TEMPORARIO', ate: conta.bloqueadoAte };
  }
  if (conta.status === 'PENDENTE_CONFIRMACAO' || !conta.emailConfirmado) {
    return { motivo: 'EMAIL_NAO_CONFIRMADO' };
  }
  if (conta.status !== 'ATIVA') {
    return { motivo: 'CONTA_INDISPONIVEL' };
  }
  return null;
}

/**
 * Registra uma senha errada (FA01, FA02). Um bloqueio vencido zera o contador antes.
 * Na quinta falha seguida a conta fica bloqueada por 5 minutos (RN03).
 */
export function registrarFalhaLogin(
  conta: Pick<EstadoLogin, 'tentativasLoginFalhas' | 'bloqueadoAte'>,
  agora: Date,
): { tentativasLoginFalhas: number; bloqueadoAte: Date | null } {
  const bloqueioVencido =
    conta.bloqueadoAte !== null && conta.bloqueadoAte <= agora;
  const tentativas = (bloqueioVencido ? 0 : conta.tentativasLoginFalhas) + 1;
  if (tentativas >= MAX_TENTATIVAS_LOGIN) {
    return {
      tentativasLoginFalhas: 0,
      bloqueadoAte: new Date(agora.getTime() + MINUTOS_BLOQUEIO * 60_000),
    };
  }
  return { tentativasLoginFalhas: tentativas, bloqueadoAte: null };
}

/** Sessão encerrada por inatividade (RN04, FA03). */
export function sessaoExpirada(
  ultimaAtividade: Date,
  agora: Date,
  horasInatividade: number,
): boolean {
  return (
    agora.getTime() - ultimaAtividade.getTime() > horasInatividade * 3_600_000
  );
}
