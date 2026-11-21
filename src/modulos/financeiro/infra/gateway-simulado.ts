import { randomInt } from 'node:crypto';
import {
  GatewayPagamento,
  MetodoPagamento,
  SituacaoCobranca,
} from '../dominio/pagamento';

/** Token de cartão de teste que o gateway simulado recusa (CT-44-02). */
export const CARTAO_RECUSADO = 'cartao-teste-recusado';

/**
 * Gateway usado sem credenciais (desenvolvimento e testes): guarda as cobranças em memória.
 * O PIX fica pendente até `pagarPix`, como se o tutor pagasse no banco; o cartão de teste
 * `cartao-teste-recusado` é recusado e os demais são aprovados.
 */
export class GatewaySimulado implements GatewayPagamento {
  readonly nome = 'simulado';
  private readonly cobrancas = new Map<string, SituacaoCobranca>();
  private readonly porPagamento = new Map<string, string>();

  criarCobranca(pedido: {
    pagamentoId: string;
    valor: number;
    metodo: MetodoPagamento;
    cartao?: { token: string };
  }): Promise<SituacaoCobranca> {
    // Mesma chave de idempotência, mesma cobrança.
    const existente = this.porPagamento.get(pedido.pagamentoId);
    if (existente) return Promise.resolve(this.cobrancas.get(existente)!);

    const codigoTransacao = String(randomInt(1_000_000_000, 9_999_999_999));
    const situacao: SituacaoCobranca =
      pedido.metodo === 'PIX'
        ? {
            codigoTransacao,
            status: 'PENDENTE',
            detalhe: 'pending_waiting_transfer',
            qrCode: `00020126580014br.gov.bcb.pix-SIMULADO-${codigoTransacao}-${pedido.valor.toFixed(2)}`,
          }
        : pedido.cartao?.token === CARTAO_RECUSADO
          ? {
              codigoTransacao,
              status: 'RECUSADO',
              detalhe: 'cc_rejected_insufficient_amount',
            }
          : { codigoTransacao, status: 'ACEITO', detalhe: 'accredited' };
    this.cobrancas.set(codigoTransacao, situacao);
    this.porPagamento.set(pedido.pagamentoId, codigoTransacao);
    return Promise.resolve(situacao);
  }

  consultar(codigoTransacao: string): Promise<SituacaoCobranca | null> {
    return Promise.resolve(this.cobrancas.get(codigoTransacao) ?? null);
  }

  /** Simula o tutor pagando o PIX no banco. */
  pagarPix(codigoTransacao: string) {
    const cobranca = this.cobrancas.get(codigoTransacao);
    if (cobranca) cobranca.status = 'ACEITO';
  }
}
