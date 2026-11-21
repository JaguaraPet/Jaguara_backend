import { fimDoPeriodo, inicioDoNovoPeriodo } from './assinatura';

describe('assinatura PANTERA (ADR-010)', () => {
  it('deve durar até o mesmo dia do mês seguinte', () => {
    expect(fimDoPeriodo('2026-11-21')).toBe('2026-12-21');
    expect(fimDoPeriodo('2026-12-15')).toBe('2027-01-15');
    expect(fimDoPeriodo('2027-01-31')).toBe('2027-02-28');
    expect(fimDoPeriodo('2028-01-31')).toBe('2028-02-29');
  });

  it('deve emendar a renovação no fim do período em vigor', () => {
    expect(inicioDoNovoPeriodo('2026-11-21', null)).toBe('2026-11-21');
    expect(inicioDoNovoPeriodo('2026-11-21', '2026-11-20')).toBe('2026-11-21');
    expect(inicioDoNovoPeriodo('2026-11-21', '2026-11-30')).toBe('2026-12-01');
  });
});
