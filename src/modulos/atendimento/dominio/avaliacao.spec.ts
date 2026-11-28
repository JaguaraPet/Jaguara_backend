import { dentroDoPrazo, notaValida, primeiroNome, resumir } from './avaliacao';

describe('avaliação', () => {
  it('aceita só notas inteiras de 1 a 5', () => {
    expect([0, 1, 3.5, 5, 6].map(notaValida)).toEqual([
      false,
      true,
      false,
      true,
      false,
    ]);
  });

  it('resume com média de uma casa e distribuição por nota', () => {
    expect(resumir([5, 4, 4])).toEqual({
      media: 4.3,
      total: 3,
      distribuicao: [0, 0, 0, 2, 1],
    });
    expect(resumir([])).toEqual({
      media: null,
      total: 0,
      distribuicao: [0, 0, 0, 0, 0],
    });
  });

  it('aceita avaliar em até 30 dias', () => {
    const agora = new Date('2026-11-30T12:00:00Z');
    expect(dentroDoPrazo(new Date('2026-11-01T12:00:00Z'), agora)).toBe(true);
    expect(dentroDoPrazo(new Date('2026-10-30T11:00:00Z'), agora)).toBe(false);
  });

  it('mostra só o primeiro nome', () => {
    expect(primeiroNome('  Ana Ribeiro ')).toBe('Ana');
  });
});
