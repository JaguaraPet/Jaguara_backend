import { dataBrasilia, diaDaSemanaBrasilia, emBrasilia } from './horario-sp';
import {
  cnpjAleatorio,
  cpfAleatorio,
  cpfComDigitos,
  ehEmailDemonstracao,
  emailDemonstracao,
} from './identificadores';

describe('Demonstração · horários em Brasília', () => {
  // 21/11/2026, 23h30 em Brasília = 22/11/2026, 02h30 UTC
  const agora = new Date('2026-11-22T02:30:00Z');

  it('deve usar o dia de Brasília, e não o de UTC, perto da meia-noite', () => {
    expect(emBrasilia(agora, 0, '09:00').toISOString()).toBe(
      '2026-11-21T12:00:00.000Z',
    );
    expect(dataBrasilia(agora, 1).toISOString()).toBe(
      '2026-11-22T00:00:00.000Z',
    );
  });

  it('deve informar o dia da semana de Brasília', () => {
    expect(diaDaSemanaBrasilia(agora, 0)).toBe(6); // sábado
    expect(diaDaSemanaBrasilia(agora, 1)).toBe(0); // domingo
  });
});

describe('Demonstração · identificadores', () => {
  it('deve gerar CPF com dígitos verificadores válidos', () => {
    expect(cpfComDigitos('529982247')).toBe('52998224725');
    expect(cpfAleatorio()).toMatch(/^9\d{10}$/);
  });

  it('deve gerar CNPJ de 14 dígitos', () => {
    expect(cnpjAleatorio()).toMatch(/^\d{14}$/);
  });

  it('deve reconhecer os e-mails do domínio reservado, que nunca recebem mensagem', () => {
    const email = emailDemonstracao('clinica', 'abc');
    expect(email).toBe('clinica.abc@demonstracao.invalid');
    expect(ehEmailDemonstracao(email.toUpperCase())).toBe(true);
    expect(ehEmailDemonstracao('ana@exemplo.com')).toBe(false);
  });
});
