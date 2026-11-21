import { Logger } from '@nestjs/common';
import {
  GatewayPagamento,
  MetodoPagamento,
  SituacaoCobranca,
  statusDoGateway,
} from '../dominio/pagamento';

/** Falha de comunicação com o gateway: o pagamento fica PENDENTE (ARQ-03, seção 3.1). */
export class GatewayIndisponivel extends Error {}

interface PagamentoMercadoPago {
  id: number;
  status: string;
  status_detail?: string;
  point_of_interaction?: { transaction_data?: { qr_code?: string } };
}

const URL_PADRAO = 'https://api.mercadopago.com';

/**
 * Gateway Mercado Pago pela API REST de pagamentos. Com credenciais de teste, roda no
 * ambiente de testes do provedor. O cartão chega já tokenizado pelo app (sem dados de cartão).
 */
export class GatewayMercadoPago implements GatewayPagamento {
  readonly nome = 'mercado-pago';
  private readonly log = new Logger(GatewayMercadoPago.name);

  constructor(
    private readonly tokenAcesso: string,
    private readonly urlNotificacao: string | undefined,
    private readonly urlBase = URL_PADRAO,
    private readonly buscar: typeof fetch = (entrada, opcoes) =>
      globalThis.fetch(entrada, opcoes),
  ) {}

  async criarCobranca(pedido: {
    pagamentoId: string;
    valor: number;
    metodo: MetodoPagamento;
    descricao: string;
    emailPagador: string;
    cartao?: { token: string; bandeira: string; parcelas: number };
  }): Promise<SituacaoCobranca> {
    const corpo = {
      transaction_amount: pedido.valor,
      description: pedido.descricao,
      external_reference: pedido.pagamentoId,
      payer: { email: pedido.emailPagador },
      ...(this.urlNotificacao ? { notification_url: this.urlNotificacao } : {}),
      ...(pedido.metodo === 'PIX'
        ? { payment_method_id: 'pix' }
        : {
            payment_method_id: pedido.cartao?.bandeira,
            token: pedido.cartao?.token,
            installments: pedido.cartao?.parcelas ?? 1,
          }),
    };
    const resposta = await this.chamar('/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // O id do pagamento é a chave de idempotência (ARQ-03, seção 3.1).
        'X-Idempotency-Key': pedido.pagamentoId,
      },
      body: JSON.stringify(corpo),
    });
    if (!resposta) throw new GatewayIndisponivel();
    return this.situacao(resposta);
  }

  async consultar(codigoTransacao: string): Promise<SituacaoCobranca | null> {
    if (!/^\d+$/.test(codigoTransacao)) return null;
    const resposta = await this.chamar(`/v1/payments/${codigoTransacao}`, {
      method: 'GET',
    });
    return resposta ? this.situacao(resposta) : null;
  }

  private situacao(p: PagamentoMercadoPago): SituacaoCobranca {
    return {
      codigoTransacao: String(p.id),
      status: statusDoGateway(p.status),
      detalhe: p.status_detail,
      qrCode: p.point_of_interaction?.transaction_data?.qr_code,
    };
  }

  /** Devolve o pagamento, null quando não existe (404) ou lança se o gateway falhar. */
  private async chamar(
    caminho: string,
    opcoes: RequestInit,
  ): Promise<PagamentoMercadoPago | null> {
    let resposta: Response;
    try {
      resposta = await this.buscar(`${this.urlBase}${caminho}`, {
        ...opcoes,
        headers: {
          ...(opcoes.headers as Record<string, string>),
          Authorization: `Bearer ${this.tokenAcesso}`,
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (erro) {
      this.log.error(`Gateway sem resposta: ${String(erro)}`);
      throw new GatewayIndisponivel();
    }
    if (resposta.status === 404) return null;
    if (!resposta.ok) {
      this.log.error(
        `Gateway respondeu ${resposta.status}: ${(await resposta.text()).slice(0, 300)}`,
      );
      throw new GatewayIndisponivel();
    }
    return (await resposta.json()) as PagamentoMercadoPago;
  }
}
