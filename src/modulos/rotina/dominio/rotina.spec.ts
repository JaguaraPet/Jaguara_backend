import { horarioValido, ocorreEm, proximasDatas } from './rotina';

describe('Criador de rotinas', () => {
  it('deve acontecer todo dia a partir do início quando é diária', () => {
    const regra = {
      frequencia: 'DIARIA' as const,
      diasSemana: [],
      dataInicio: '2026-11-21',
    };
    expect(ocorreEm(regra, '2026-11-20')).toBe(false);
    expect(ocorreEm(regra, '2026-11-21')).toBe(true);
    expect(ocorreEm(regra, '2026-12-31')).toBe(true);
  });

  it('deve acontecer só nos dias da semana escolhidos quando é semanal', () => {
    // 23/11/2026 é segunda; 24/11, terça
    const regra = {
      frequencia: 'SEMANAL' as const,
      diasSemana: [1, 3, 5],
      dataInicio: '2026-11-01',
    };
    expect(ocorreEm(regra, '2026-11-23')).toBe(true);
    expect(ocorreEm(regra, '2026-11-24')).toBe(false);
  });

  it('deve repetir a cada N dias contando do início', () => {
    const regra = {
      frequencia: 'INTERVALO_DIAS' as const,
      intervaloDias: 15,
      diasSemana: [],
      dataInicio: '2026-11-01',
    };
    expect(proximasDatas(regra, '2026-11-01', 40)).toEqual([
      '2026-11-01',
      '2026-11-16',
      '2026-12-01',
    ]);
  });

  it('deve cair no último dia dos meses curtos quando começou no dia 31', () => {
    const regra = {
      frequencia: 'MENSAL' as const,
      diasSemana: [],
      dataInicio: '2026-01-31',
    };
    expect(ocorreEm(regra, '2026-02-28')).toBe(true);
    expect(ocorreEm(regra, '2026-03-31')).toBe(true);
    expect(ocorreEm(regra, '2026-03-30')).toBe(false);
  });

  it('deve aceitar só horários HH:MM válidos', () => {
    expect(horarioValido('07:00')).toBe(true);
    expect(horarioValido('24:00')).toBe(false);
    expect(horarioValido('7:00')).toBe(false);
  });
});
