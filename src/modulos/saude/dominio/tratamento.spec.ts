import { validarTratamento } from './tratamento';

describe('tratamento medicamentoso (UC-14)', () => {
  const hoje = '2026-11-21';
  const base = { intervaloHoras: 8, dataInicio: '2026-11-21' };

  it('deve aceitar o tratamento com intervalo, datas e hora válidos', () => {
    expect(validarTratamento(base, hoje)).toBeNull();
    expect(
      validarTratamento(
        { ...base, dataFim: '2026-11-28', horaPrimeiraDose: '20:30' },
        hoje,
      ),
    ).toBeNull();
  });

  it('deve recusar intervalo fora de 1 a 720 horas', () => {
    expect(validarTratamento({ ...base, intervaloHoras: 0 }, hoje)?.campo).toBe(
      'intervaloHoras',
    );
    expect(
      validarTratamento({ ...base, intervaloHoras: 721 }, hoje)?.campo,
    ).toBe('intervaloHoras');
    expect(
      validarTratamento({ ...base, intervaloHoras: 1.5 }, hoje)?.campo,
    ).toBe('intervaloHoras');
  });

  it('deve recusar fim antes do início ou no passado e hora malformada', () => {
    expect(
      validarTratamento({ ...base, dataFim: '2026-11-20' }, hoje)?.campo,
    ).toBe('dataFim');
    expect(
      validarTratamento(
        { ...base, dataInicio: '2026-11-01', dataFim: '2026-11-10' },
        hoje,
      )?.mensagem,
    ).toContain('já terminou');
    expect(
      validarTratamento({ ...base, horaPrimeiraDose: '25:00' }, hoje)?.campo,
    ).toBe('horaPrimeiraDose');
  });
});
