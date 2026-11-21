import {
  diaDeBrasilia,
  resumoDoDia,
  somarGramas,
  validarPlano,
} from './alimentacao';

describe('alimentação (UC-08, RN12)', () => {
  const plano = { metaDiariaGramas: 250, limiteDiarioGramas: 300 };

  it('CT-08-01: deve somar o consumo do dia sem alerta dentro do limite', () => {
    expect(resumoDoDia([200], plano)).toEqual({
      consumoDoDia: 200,
      metaDiariaGramas: 250,
      limiteDiarioGramas: 300,
      percentualMeta: 80,
      limiteExcedido: false,
    });
  });

  it('CT-08-02: deve alertar quando o consumo passa do limite', () => {
    expect(resumoDoDia([250, 100], plano)).toMatchObject({
      consumoDoDia: 350,
      limiteExcedido: true,
    });
    expect(resumoDoDia([200, 100], plano).limiteExcedido).toBe(false);
  });

  it('deve funcionar sem plano e sem limite', () => {
    expect(resumoDoDia([10.1, 20.2], null)).toEqual({
      consumoDoDia: 30.3,
      limiteExcedido: false,
    });
    expect(
      resumoDoDia([999], { metaDiariaGramas: 100, limiteDiarioGramas: null })
        .limiteExcedido,
    ).toBe(false);
    expect(somarGramas([])).toBe(0);
  });

  it('deve exigir meta positiva, limite não menor que a meta e refeições de 1 a 12', () => {
    const base = { metaDiariaGramas: 250, refeicoesPorDia: 2 };
    expect(validarPlano(base)).toBeNull();
    expect(validarPlano({ ...base, metaDiariaGramas: 0 })?.campo).toBe(
      'metaDiariaGramas',
    );
    expect(validarPlano({ ...base, limiteDiarioGramas: 200 })?.campo).toBe(
      'limiteDiarioGramas',
    );
    expect(validarPlano({ ...base, refeicoesPorDia: 0 })?.campo).toBe(
      'refeicoesPorDia',
    );
  });

  it('deve usar o dia de Brasília', () => {
    const dia = diaDeBrasilia(new Date('2026-11-22T02:30:00Z'));
    expect(dia.data).toBe('2026-11-21');
    expect(dia.inicio.toISOString()).toBe('2026-11-21T03:00:00.000Z');
    expect(dia.fim.toISOString()).toBe('2026-11-22T03:00:00.000Z');
  });
});
