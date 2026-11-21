import {
  assinaturaValida,
  assinaturaWebhook,
  motivoRecusa,
  podeMudar,
  statusDoGateway,
} from './pagamento';

describe('pagamento (UC-44, RN39, RN36)', () => {
  it('deve traduzir o status do gateway (ARQ-03, seção 3.1)', () => {
    expect(statusDoGateway('approved')).toBe('ACEITO');
    expect(statusDoGateway('rejected')).toBe('RECUSADO');
    expect(statusDoGateway('cancelled')).toBe('CANCELADO');
    expect(statusDoGateway('expired')).toBe('CANCELADO');
    expect(statusDoGateway('refunded')).toBe('CANCELADO');
    expect(statusDoGateway('pending')).toBe('PENDENTE');
    expect(statusDoGateway('in_process')).toBe('PENDENTE');
  });

  it('não deve deixar um estado final voltar (RN39)', () => {
    expect(podeMudar('PENDENTE', 'ACEITO')).toBe(true);
    expect(podeMudar('PENDENTE', 'RECUSADO')).toBe(true);
    expect(podeMudar('ACEITO', 'CANCELADO')).toBe(true);
    expect(podeMudar('ACEITO', 'PENDENTE')).toBe(false);
    expect(podeMudar('RECUSADO', 'ACEITO')).toBe(false);
    expect(podeMudar('CANCELADO', 'ACEITO')).toBe(false);
    expect(podeMudar('ACEITO', 'ACEITO')).toBe(false);
  });

  it('CT-44-02: deve explicar a recusa ao tutor', () => {
    expect(motivoRecusa('cc_rejected_insufficient_amount')).toBe(
      'Saldo ou limite insuficiente.',
    );
    expect(motivoRecusa('outro')).toContain('Tente outro cartão');
    expect(motivoRecusa()).toContain('PIX');
  });

  it('deve aceitar só o webhook com a assinatura certa', () => {
    const dados = { dataId: '123', requestId: 'req-1', ts: '1700000000' };
    const v1 = assinaturaWebhook('segredo', dados);
    const cabecalhos = {
      assinatura: `ts=${dados.ts},v1=${v1}`,
      requestId: 'req-1',
    };
    expect(assinaturaValida('segredo', cabecalhos, '123')).toBe(true);
    expect(assinaturaValida('outro', cabecalhos, '123')).toBe(false);
    expect(assinaturaValida('segredo', cabecalhos, '124')).toBe(false);
    expect(
      assinaturaValida('segredo', { ...cabecalhos, requestId: 'x' }, '123'),
    ).toBe(false);
    expect(
      assinaturaValida('segredo', { assinatura: 'ts=1,v1=abc' }, '123'),
    ).toBe(false);
    expect(assinaturaValida(undefined, cabecalhos, '123')).toBe(false);
    expect(
      assinaturaValida('segredo', { ...cabecalhos, assinatura: 'lixo' }, '123'),
    ).toBe(false);
  });
});
