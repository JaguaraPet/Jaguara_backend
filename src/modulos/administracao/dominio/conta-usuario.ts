/** Regras da gestão de contas pela administração (UC-28, RN34). */

export type StatusConta =
  'PENDENTE_CONFIRMACAO' | 'ATIVA' | 'BLOQUEADA' | 'SUSPENSA' | 'INATIVA';

export type NovoStatus = 'ATIVA' | 'BLOQUEADA' | 'SUSPENSA';
export type TipoConta = 'TUTOR' | 'EMPRESA' | 'FUNCIONARIO' | 'ADMINISTRADOR';

/** Ação registrada na auditoria para cada mudança de status. */
export const ACAO_DO_STATUS: Record<NovoStatus, string> = {
  ATIVA: 'CONTA_REATIVADA',
  BLOQUEADA: 'CONTA_BLOQUEADA',
  SUSPENSA: 'CONTA_SUSPENSA',
};

/**
 * Motivo para recusar a mudança, ou null se ela vale. Conta que ainda não confirmou o e-mail
 * ou que o titular excluiu (LGPD) não passa pela gestão; a própria conta também não.
 */
export function motivoRecusa(v: {
  atual: StatusConta;
  novo: NovoStatus;
  propriaConta: boolean;
}): string | null {
  if (v.propriaConta) return 'Você não pode alterar a sua própria conta.';
  if (v.atual === 'PENDENTE_CONFIRMACAO' || v.atual === 'INATIVA') {
    return 'Esta conta não pode ser alterada pela administração.';
  }
  if (v.atual === v.novo) return 'A conta já está neste status.';
  return null;
}

export function tipoDaConta(u: {
  tutor: unknown;
  empresaEnterprise: unknown;
  funcionarioEnterprise: unknown;
  administrador: unknown;
}): TipoConta {
  if (u.administrador) return 'ADMINISTRADOR';
  if (u.empresaEnterprise) return 'EMPRESA';
  if (u.funcionarioEnterprise) return 'FUNCIONARIO';
  return 'TUTOR';
}
