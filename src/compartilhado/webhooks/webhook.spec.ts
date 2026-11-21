import { createHmac } from 'node:crypto';
import { assinar, motivoUrlInvalida } from './webhook';

describe('webhooks de saída (RN36)', () => {
  it('deve assinar o carimbo de tempo e o corpo com HMAC-SHA256', () => {
    const corpo = '{"id":"e1"}';
    const esperado = createHmac('sha256', 'segredo')
      .update(`1700000000.${corpo}`)
      .digest('hex');
    expect(assinar('segredo', corpo, 1700000000)).toBe(
      `t=1700000000,v1=${esperado}`,
    );
    expect(assinar('outro', corpo, 1700000000)).not.toBe(
      assinar('segredo', corpo, 1700000000),
    );
  });

  it('CT-30-02: deve aceitar só HTTPS público sem credenciais na URL', () => {
    expect(motivoUrlInvalida('https://parceiro.exemplo.com/hook')).toBeNull();
    expect(motivoUrlInvalida('http://parceiro.exemplo.com')).toContain('HTTPS');
    expect(motivoUrlInvalida('https://user:senha@exemplo.com')).toContain(
      'usuário',
    );
    expect(motivoUrlInvalida('https://localhost/hook')).toContain('público');
    expect(motivoUrlInvalida('https://192.168.0.10/hook')).toContain('público');
    expect(motivoUrlInvalida('https://10.0.0.1/hook')).toContain('público');
    expect(motivoUrlInvalida('nao é url')).toContain('válida');
  });
});
