import { createHmac } from 'node:crypto';

/** Webhooks de saída para sistemas parceiros (ARQ-03, seção 3.7; RN36). */

export const EVENTOS_WEBHOOK = [
  'solicitacao.criada',
  'solicitacao.status_alterado',
  'agendamento.criado',
  'agendamento.cancelado',
  'atendimento.finalizado',
  'pagamento.confirmado',
] as const;

export type EventoWebhook = (typeof EVENTOS_WEBHOOK)[number];

export const FILA_WEBHOOKS = 'webhooks';
export const TENTATIVAS_WEBHOOK = 5;

/** Corpo enviado: o id do evento serve para o destinatário descartar duplicatas. */
export interface EnvioWebhook {
  id: string;
  evento: EventoWebhook;
  criadoEm: string;
  dados: Record<string, unknown>;
}

/**
 * Cabeçalho `X-Jaguara-Assinatura: t=<segundos>,v1=<hex>`, com HMAC-SHA256 de
 * `<t>.<corpo>` e o segredo do webhook (RN36).
 */
export function assinar(segredo: string, corpo: string, t: number): string {
  const v1 = createHmac('sha256', segredo)
    .update(`${t}.${corpo}`)
    .digest('hex');
  return `t=${t},v1=${v1}`;
}

/** CT-30-02: só HTTPS, sem credenciais na URL e fora da rede local. */
export function motivoUrlInvalida(url: string): string | null {
  let alvo: URL;
  try {
    alvo = new URL(url);
  } catch {
    return 'Informe uma URL válida.';
  }
  if (alvo.protocol !== 'https:') {
    return 'Use uma URL HTTPS: os eventos só são enviados por conexão segura (RN36).';
  }
  if (alvo.username || alvo.password) {
    return 'Não coloque usuário ou senha na URL; a autenticação é pela assinatura.';
  }
  const host = alvo.hostname;
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    /^(127|10)\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === '[::1]'
  ) {
    return 'Use um endereço público; a rede interna não é permitida.';
  }
  return null;
}
