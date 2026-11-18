import { HttpStatus } from '@nestjs/common';

/**
 * Erro de negócio com código estável, devolvido no formato application/problem+json
 * (RFC 9457) com o campo `codigo` (ARQ-01, OpenAPI).
 */
export class ErroNegocio extends Error {
  constructor(
    readonly status: HttpStatus,
    readonly codigo: string,
    readonly titulo: string,
    readonly detalhe?: string,
  ) {
    super(detalhe ?? titulo);
  }
}

export const Erros = {
  credenciaisInvalidas: () =>
    new ErroNegocio(
      HttpStatus.UNAUTHORIZED,
      'CREDENCIAIS_INVALIDAS',
      'E-mail ou senha incorretos',
    ),
  contaBloqueada: (ate: Date) =>
    new ErroNegocio(
      HttpStatus.LOCKED,
      'RN03_CONTA_BLOQUEADA',
      'Conta bloqueada temporariamente',
      `Muitas tentativas sem sucesso. Tente de novo depois de ${ate.toISOString()}.`,
    ),
  emailNaoConfirmado: () =>
    new ErroNegocio(
      HttpStatus.FORBIDDEN,
      'RN02_EMAIL_NAO_CONFIRMADO',
      'Confirme seu e-mail para entrar',
    ),
  contaInativa: () =>
    new ErroNegocio(
      HttpStatus.FORBIDDEN,
      'CONTA_INDISPONIVEL',
      'Esta conta não está ativa',
    ),
  naoAutenticado: (detalhe?: string) =>
    new ErroNegocio(
      HttpStatus.UNAUTHORIZED,
      'NAO_AUTENTICADO',
      'Autenticação necessária',
      detalhe,
    ),
  sessaoExpirada: () =>
    new ErroNegocio(
      HttpStatus.UNAUTHORIZED,
      'RN04_SESSAO_EXPIRADA',
      'Sessão encerrada por inatividade',
      'Entre de novo para continuar.',
    ),
};
