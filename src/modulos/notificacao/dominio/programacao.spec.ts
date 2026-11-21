import {
  ANTECEDENCIA_PADRAO,
  aposFalha,
  configuracaoEfetiva,
  MAXIMO_TENTATIVAS,
  programar,
} from './programacao';

describe('programação das notificações (UC-31, RN37)', () => {
  const agora = new Date('2026-11-21T12:00:00Z');
  const dose20h = new Date('2026-11-21T23:00:00Z'); // 20h em Brasília

  it('CT-31-01: deve avisar às 19h30 a dose das 20h com 30 minutos de antecedência', () => {
    const configuracao = {
      tipoEvento: 'MEDICAMENTO' as const,
      canal: 'PUSH' as const,
      antecedenciaMinutos: 30,
      ativa: true,
    };
    expect(programar(dose20h, configuracao, agora)?.toISOString()).toBe(
      '2026-11-21T22:30:00.000Z',
    );
  });

  it('deve usar o padrão do tipo e não agendar desligada ou no passado', () => {
    const padrao = configuracaoEfetiva('VACINA');
    expect(padrao).toMatchObject({
      canal: 'PUSH',
      antecedenciaMinutos: ANTECEDENCIA_PADRAO.VACINA,
      ativa: true,
    });
    expect(programar(dose20h, { ...padrao, ativa: false }, agora)).toBeNull();
    expect(
      programar(new Date('2026-11-21T12:30:00Z'), padrao, agora),
    ).toBeNull();
  });

  it('CT-31-02: deve reagendar com espera exponencial e desistir na quinta falha', () => {
    expect(aposFalha(0, agora)).toEqual({
      status: 'AGENDADA',
      proxima: new Date('2026-11-21T12:01:00Z'),
    });
    expect(aposFalha(3, agora)).toEqual({
      status: 'AGENDADA',
      proxima: new Date('2026-11-21T12:08:00Z'),
    });
    expect(aposFalha(MAXIMO_TENTATIVAS - 1, agora)).toEqual({
      status: 'FALHOU',
    });
  });
});
