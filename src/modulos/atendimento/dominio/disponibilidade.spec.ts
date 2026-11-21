import {
  diaDaSemana,
  horariosDisponiveis,
  inicioDoDiaBrasilia,
} from './disponibilidade';

describe('disponibilidade (RN40, RN29)', () => {
  const agora = new Date('2026-11-20T12:00:00Z');
  const data = '2026-11-23'; // segunda-feira
  const janela = { donoId: 'vet', inicioMin: 14 * 60, fimMin: 18 * 60 };

  it('deve calcular a meia-noite e o dia da semana em Brasília', () => {
    expect(inicioDoDiaBrasilia(data).toISOString()).toBe(
      '2026-11-23T03:00:00.000Z',
    );
    expect(diaDaSemana(data)).toBe(1);
  });

  it('deve oferecer os inícios em que o serviço inteiro cabe no turno', () => {
    const livres = horariosDisponiveis({
      data,
      duracaoMinutos: 60,
      janelas: [janela],
      ocupacoes: [],
      agora,
    });
    expect(livres.map((d) => d.toISOString())).toEqual([
      '2026-11-23T17:00:00.000Z',
      '2026-11-23T17:30:00.000Z',
      '2026-11-23T18:00:00.000Z',
      '2026-11-23T18:30:00.000Z',
      '2026-11-23T19:00:00.000Z',
      '2026-11-23T19:30:00.000Z',
      '2026-11-23T20:00:00.000Z',
    ]);
  });

  it('não deve oferecer horários que cruzam um agendamento do mesmo profissional', () => {
    const ocupacoes = [
      {
        donoId: 'vet',
        inicio: new Date('2026-11-23T18:00:00Z'),
        fim: new Date('2026-11-23T19:00:00Z'),
      },
    ];
    const livres = horariosDisponiveis({
      data,
      duracaoMinutos: 60,
      janelas: [janela],
      ocupacoes,
      agora,
    });
    expect(livres).toHaveLength(4);
  });

  it('deve manter o horário quando outro profissional está livre', () => {
    const ocupacoes = [
      {
        donoId: 'vet',
        inicio: new Date('2026-11-23T18:00:00Z'),
        fim: new Date('2026-11-23T19:00:00Z'),
      },
    ];
    const livres = horariosDisponiveis({
      data,
      duracaoMinutos: 60,
      janelas: [janela, { ...janela, donoId: 'vet2' }],
      ocupacoes,
      agora,
    });
    expect(livres).toHaveLength(7);
  });

  it('não deve oferecer horários que já passaram', () => {
    const livres = horariosDisponiveis({
      data,
      duracaoMinutos: 60,
      janelas: [janela],
      ocupacoes: [],
      agora: new Date('2026-11-23T19:10:00Z'),
    });
    expect(livres.map((d) => d.toISOString())).toEqual([
      '2026-11-23T19:30:00.000Z',
      '2026-11-23T20:00:00.000Z',
    ]);
  });
});
