import {
  GatewayIndisponivel,
  GatewayMercadoPago,
} from './gateway-mercado-pago';
import { CARTAO_RECUSADO, GatewaySimulado } from './gateway-simulado';

describe('gateways de pagamento', () => {
  const resposta = (status: number, corpo: unknown) =>
    new Response(JSON.stringify(corpo), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  it('deve criar a cobrança PIX com chave de idempotência e sem dados de cartão', async () => {
    const buscar = jest.fn().mockResolvedValue(
      resposta(201, {
        id: 123,
        status: 'pending',
        status_detail: 'pending_waiting_transfer',
        point_of_interaction: {
          transaction_data: { qr_code: 'pix-copia-e-cola' },
        },
      }),
    );
    const gateway = new GatewayMercadoPago(
      'TEST-token',
      'https://api.exemplo.com/v1/webhooks/pagamentos',
      'https://mp.exemplo',
      buscar,
    );
    await expect(
      gateway.criarCobranca({
        pagamentoId: 'p1',
        valor: 60,
        metodo: 'PIX',
        descricao: 'Banho - Thor',
        emailPagador: 'ana@exemplo.com',
      }),
    ).resolves.toEqual({
      codigoTransacao: '123',
      status: 'PENDENTE',
      detalhe: 'pending_waiting_transfer',
      qrCode: 'pix-copia-e-cola',
    });
    const [url, opcoes] = buscar.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://mp.exemplo/v1/payments');
    const cabecalhos = opcoes.headers as Record<string, string>;
    expect(cabecalhos['X-Idempotency-Key']).toBe('p1');
    expect(cabecalhos.Authorization).toBe('Bearer TEST-token');
    expect(JSON.parse(opcoes.body as string)).toMatchObject({
      transaction_amount: 60,
      payment_method_id: 'pix',
      external_reference: 'p1',
      notification_url: 'https://api.exemplo.com/v1/webhooks/pagamentos',
    });
  });

  it('deve emitir o boleto registrado com CPF e endereço do pagador', async () => {
    const buscar = jest.fn().mockResolvedValue(
      resposta(201, {
        id: 456,
        status: 'pending',
        status_detail: 'pending_waiting_payment',
        date_of_expiration: '2026-11-23T23:59:59.000-03:00',
        barcode: { content: '23791234500000060003381260000000000000000000' },
        transaction_details: {
          external_resource_url: 'https://mp.exemplo/boleto/456',
          digitable_line:
            '23793.38128 60000.000003 00000.000000 1 12345000006000',
        },
      }),
    );
    const gateway = new GatewayMercadoPago(
      'TEST-token',
      undefined,
      'https://mp.exemplo',
      buscar,
    );
    await expect(
      gateway.criarCobranca({
        pagamentoId: 'p3',
        valor: 60,
        metodo: 'BOLETO',
        descricao: 'Banho - Thor',
        emailPagador: 'ana@exemplo.com',
        pagador: {
          nome: 'Ana Maria Souza',
          cpf: '52998224725',
          endereco: {
            cep: '01310100',
            logradouro: 'Avenida Paulista',
            numero: '1000',
            bairro: 'Bela Vista',
            cidade: 'São Paulo',
            uf: 'SP',
          },
        },
      }),
    ).resolves.toMatchObject({
      codigoTransacao: '456',
      status: 'PENDENTE',
      boleto: {
        url: 'https://mp.exemplo/boleto/456',
        linhaDigitavel:
          '23793.38128 60000.000003 00000.000000 1 12345000006000',
        vencimento: '2026-11-23T23:59:59.000-03:00',
      },
    });
    const corpo = JSON.parse(
      (buscar.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as Record<string, unknown>;
    expect(corpo).toMatchObject({
      payment_method_id: 'bolbradesco',
      payer: {
        email: 'ana@exemplo.com',
        first_name: 'Ana',
        last_name: 'Maria Souza',
        identification: { type: 'CPF', number: '52998224725' },
        address: { zip_code: '01310100', federal_unit: 'SP' },
      },
    });
    expect(corpo.date_of_expiration).toMatch(
      /^\d{4}-\d{2}-\d{2}T23:59:59\.000-03:00$/,
    );
    expect(corpo).not.toHaveProperty('token');
  });

  it('deve mandar só o token do cartão e consultar o status', async () => {
    const buscar = jest
      .fn()
      .mockResolvedValueOnce(resposta(201, { id: 9, status: 'approved' }))
      .mockResolvedValueOnce(resposta(200, { id: 9, status: 'approved' }))
      .mockResolvedValueOnce(resposta(404, {}));
    const gateway = new GatewayMercadoPago(
      't',
      undefined,
      'https://mp',
      buscar,
    );
    await gateway.criarCobranca({
      pagamentoId: 'p2',
      valor: 80,
      metodo: 'CARTAO_CREDITO',
      descricao: 'Tosa',
      emailPagador: 'ana@exemplo.com',
      cartao: { token: 'tok', bandeira: 'visa', parcelas: 2 },
    });
    const corpo = JSON.parse(
      (buscar.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as Record<string, unknown>;
    expect(corpo).toMatchObject({
      token: 'tok',
      payment_method_id: 'visa',
      installments: 2,
    });
    expect(corpo).not.toHaveProperty('notification_url');
    await expect(gateway.consultar('9')).resolves.toMatchObject({
      status: 'ACEITO',
    });
    await expect(gateway.consultar('10')).resolves.toBeNull();
    await expect(gateway.consultar('nao-numerico')).resolves.toBeNull();
  });

  it('deve tratar erro e falta de resposta como gateway indisponível', async () => {
    const erro = new GatewayMercadoPago(
      't',
      undefined,
      'https://mp',
      jest.fn().mockResolvedValue(resposta(500, { message: 'falhou' })),
    );
    await expect(erro.consultar('1')).rejects.toBeInstanceOf(
      GatewayIndisponivel,
    );
    const rede = new GatewayMercadoPago(
      't',
      undefined,
      'https://mp',
      jest.fn().mockRejectedValue(new Error('ECONNRESET')),
    );
    await expect(
      rede.criarCobranca({
        pagamentoId: 'p',
        valor: 1,
        metodo: 'PIX',
        descricao: 'x',
        emailPagador: 'a@b.c',
      }),
    ).rejects.toBeInstanceOf(GatewayIndisponivel);
  });

  it('deve simular PIX pendente até o pagamento e recusar o cartão de teste', async () => {
    const simulado = new GatewaySimulado();
    const pix = await simulado.criarCobranca({
      pagamentoId: 'p1',
      valor: 60,
      metodo: 'PIX',
    });
    expect(pix.status).toBe('PENDENTE');
    expect(pix.qrCode).toContain('SIMULADO');
    await expect(
      simulado.criarCobranca({ pagamentoId: 'p1', valor: 60, metodo: 'PIX' }),
    ).resolves.toBe(pix);
    simulado.pagarPix(pix.codigoTransacao);
    await expect(
      simulado.consultar(pix.codigoTransacao),
    ).resolves.toMatchObject({ status: 'ACEITO' });
    const recusado = await simulado.criarCobranca({
      pagamentoId: 'p2',
      valor: 60,
      metodo: 'CARTAO_CREDITO',
      cartao: { token: CARTAO_RECUSADO },
    });
    expect(recusado.status).toBe('RECUSADO');
    const boleto = await simulado.criarCobranca({
      pagamentoId: 'p3',
      valor: 60,
      metodo: 'BOLETO',
    });
    expect(boleto.status).toBe('PENDENTE');
    expect(boleto.boleto?.linhaDigitavel).toMatch(/^23790/);
    simulado.pagarPix(boleto.codigoTransacao);
    await expect(
      simulado.consultar(boleto.codigoTransacao),
    ).resolves.toMatchObject({ status: 'ACEITO' });
    await expect(simulado.consultar('0')).resolves.toBeNull();
  });
});
