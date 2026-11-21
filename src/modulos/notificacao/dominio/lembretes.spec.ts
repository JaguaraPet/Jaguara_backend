import {
  dataBrasileira,
  hojeBrasilia,
  horariosDasDoses,
  instanteBrasilia,
  MAXIMO_DOSES,
  somarDias,
} from './lembretes';

describe('lembretes (RN18, RN37)', () => {
  const agora = new Date('2026-11-21T12:00:00Z'); // 9h em Brasília

  it('deve trabalhar com datas e horas de Brasília', () => {
    expect(hojeBrasilia(new Date('2026-11-22T02:00:00Z'))).toBe('2026-11-21');
    expect(instanteBrasilia('2026-11-21').toISOString()).toBe(
      '2026-11-21T12:00:00.000Z',
    );
    expect(somarDias('2026-11-30', 1)).toBe('2026-12-01');
    expect(somarDias('2026-03-01', -1)).toBe('2026-02-28');
    expect(dataBrasileira('2026-12-05')).toBe('05/12/2026');
  });

  it('CT-14-01: deve agendar as doses de 8 em 8 horas até o fim do último dia', () => {
    const doses = horariosDasDoses({
      dataInicio: '2026-11-21',
      dataFim: '2026-11-22',
      intervaloHoras: 8,
      agora,
    });
    // 8h já passou; ficam 16h e 0h do dia 21 e 8h, 16h do dia 22.
    expect(doses.map((d) => d.toISOString())).toEqual([
      '2026-11-21T19:00:00.000Z',
      '2026-11-22T03:00:00.000Z',
      '2026-11-22T11:00:00.000Z',
      '2026-11-22T19:00:00.000Z',
    ]);
  });

  it('deve limitar tratamentos sem fim aos próximos 30 dias e ao máximo de doses', () => {
    const diarias = horariosDasDoses({
      dataInicio: '2026-11-22',
      horaPrimeiraDose: '20:00',
      intervaloHoras: 24,
      agora,
    });
    expect(diarias).toHaveLength(30);
    expect(diarias[0].toISOString()).toBe('2026-11-22T23:00:00.000Z');
    const frequentes = horariosDasDoses({
      dataInicio: '2026-11-22',
      intervaloHoras: 1,
      agora,
    });
    expect(frequentes).toHaveLength(MAXIMO_DOSES);
  });
});
