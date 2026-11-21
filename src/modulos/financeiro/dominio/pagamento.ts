import { createHmac, timingSafeEqual } from 'node:crypto';

/** Pagamento de serviço (UC-44) e regras de integridade das transações (RN39). */

export type StatusPagamento = 'PENDENTE' | 'ACEITO' | 'CANCELADO' | 'RECUSADO';
export type MetodoPagamento =
  'CARTAO_CREDITO' | 'CARTAO_DEBITO' | 'PIX' | 'BOLETO';

/** Situação da cobrança no gateway, já traduzida para o vocabulário do Jaguara. */
export interface SituacaoCobranca {
  codigoTransacao: string;
  status: StatusPagamento;
  /** Código do provedor que explica a recusa (ex.: cc_rejected_insufficient_amount). */
  detalhe?: string;
  qrCode?: string;
}

/** Porta do gateway (ARQ-03, seção 3.1). Os dados do cartão nunca passam pela API: só o token. */
export interface GatewayPagamento {
  readonly nome: string;
  criarCobranca(pedido: {
    pagamentoId: string;
    valor: number;
    metodo: MetodoPagamento;
    descricao: string;
    emailPagador: string;
    cartao?: { token: string; bandeira: string; parcelas: number };
  }): Promise<SituacaoCobranca>;
  consultar(codigoTransacao: string): Promise<SituacaoCobranca | null>;
}

export const GATEWAY_PAGAMENTO = Symbol('GATEWAY_PAGAMENTO');

/** Prefixo do código provisório, antes de o gateway devolver o código da transação. */
export const PREFIXO_PROVISORIO = 'aguardando-';

/** Mapeamento do status do Mercado Pago para o status do Jaguara (ARQ-03, seção 3.1). */
export function statusDoGateway(status: string): StatusPagamento {
  switch (status) {
    case 'approved':
      return 'ACEITO';
    case 'rejected':
      return 'RECUSADO';
    case 'cancelled':
    case 'expired':
    case 'refunded':
    case 'charged_back':
      return 'CANCELADO';
    default:
      // pending, in_process, authorized, in_mediation
      return 'PENDENTE';
  }
}

/**
 * RN39: estados finais não voltam. PENDENTE pode ir para qualquer estado; ACEITO só sai para
 * CANCELADO (estorno ou chargeback); RECUSADO e CANCELADO não mudam mais.
 */
export function podeMudar(
  atual: StatusPagamento,
  novo: StatusPagamento,
): boolean {
  if (atual === novo) return false;
  if (atual === 'PENDENTE') return true;
  return atual === 'ACEITO' && novo === 'CANCELADO';
}

/** Motivos de recusa do cartão em linguagem do tutor (UC-44, FA1). */
export function motivoRecusa(detalhe?: string): string {
  const motivos: Record<string, string> = {
    cc_rejected_insufficient_amount: 'Saldo ou limite insuficiente.',
    cc_rejected_bad_filled_security_code: 'Código de segurança incorreto.',
    cc_rejected_bad_filled_date: 'Data de validade incorreta.',
    cc_rejected_bad_filled_other: 'Confira os dados do cartão.',
    cc_rejected_call_for_authorize:
      'O banco pediu autorização. Fale com o banco do cartão.',
    cc_rejected_card_disabled: 'Cartão desativado. Fale com o banco.',
    cc_rejected_high_risk: 'Pagamento recusado por segurança. Use outro meio.',
    cc_rejected_duplicated_payment: 'Pagamento repetido com o mesmo valor.',
  };
  return (
    (detalhe && motivos[detalhe]) ||
    'O pagamento foi recusado. Tente outro cartão ou pague com PIX.'
  );
}

/**
 * Assinatura do webhook do Mercado Pago (RN36): `x-signature: ts=...,v1=...`, HMAC-SHA256
 * de `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` com o segredo do webhook.
 */
export function assinaturaWebhook(
  segredo: string,
  dados: { dataId: string; requestId: string; ts: string },
): string {
  const manifesto = `id:${dados.dataId.toLowerCase()};request-id:${dados.requestId};ts:${dados.ts};`;
  return createHmac('sha256', segredo).update(manifesto).digest('hex');
}

/** Confere a assinatura em tempo constante; recusa cabeçalho ausente ou malformado. */
export function assinaturaValida(
  segredo: string | undefined,
  cabecalhos: { assinatura?: string; requestId?: string },
  dataId: string | undefined,
): boolean {
  if (!segredo || !cabecalhos.assinatura || !cabecalhos.requestId || !dataId)
    return false;
  const partes = Object.fromEntries(
    cabecalhos.assinatura.split(',').map((parte) => {
      const [chave, ...valor] = parte.trim().split('=');
      return [chave, valor.join('=')];
    }),
  );
  const ts = partes.ts;
  const v1 = partes.v1;
  if (!ts || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return false;
  const esperado = assinaturaWebhook(segredo, {
    dataId,
    requestId: cabecalhos.requestId,
    ts,
  });
  return timingSafeEqual(Buffer.from(esperado), Buffer.from(v1.toLowerCase()));
}
