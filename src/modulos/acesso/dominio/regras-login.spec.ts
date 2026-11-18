import {
  impedimentoDeLogin,
  registrarFalhaLogin,
  sessaoExpirada,
} from './regras-login';

const agora = new Date('2026-11-17T12:00:00Z');
const minutos = (n: number) => new Date(agora.getTime() + n * 60_000);
const contaAtiva = {
  status: 'ATIVA' as const,
  emailConfirmado: true,
  tentativasLoginFalhas: 0,
  bloqueadoAte: null,
};

describe('impedimentoDeLogin', () => {
  it('não deve impedir quando a conta está ativa e confirmada', () => {
    expect(impedimentoDeLogin(contaAtiva, agora)).toBeNull();
  });

  it('deve impedir quando o bloqueio ainda não venceu (RN03)', () => {
    expect(
      impedimentoDeLogin({ ...contaAtiva, bloqueadoAte: minutos(3) }, agora),
    ).toEqual({ motivo: 'BLOQUEIO_TEMPORARIO', ate: minutos(3) });
  });

  it('deve liberar quando o bloqueio já venceu', () => {
    expect(
      impedimentoDeLogin({ ...contaAtiva, bloqueadoAte: minutos(-1) }, agora),
    ).toBeNull();
  });

  it('deve impedir quando o e-mail não foi confirmado (RN02)', () => {
    expect(
      impedimentoDeLogin(
        {
          ...contaAtiva,
          status: 'PENDENTE_CONFIRMACAO',
          emailConfirmado: false,
        },
        agora,
      ),
    ).toEqual({ motivo: 'EMAIL_NAO_CONFIRMADO' });
  });

  it('deve impedir quando a conta está suspensa', () => {
    expect(
      impedimentoDeLogin({ ...contaAtiva, status: 'SUSPENSA' }, agora),
    ).toEqual({ motivo: 'CONTA_INDISPONIVEL' });
  });
});

describe('registrarFalhaLogin', () => {
  it('deve somar uma tentativa quando ainda não chegou a cinco', () => {
    expect(
      registrarFalhaLogin(
        { tentativasLoginFalhas: 3, bloqueadoAte: null },
        agora,
      ),
    ).toEqual({ tentativasLoginFalhas: 4, bloqueadoAte: null });
  });

  it('deve bloquear por 5 minutos quando chega à quinta falha seguida (RN03)', () => {
    expect(
      registrarFalhaLogin(
        { tentativasLoginFalhas: 4, bloqueadoAte: null },
        agora,
      ),
    ).toEqual({ tentativasLoginFalhas: 0, bloqueadoAte: minutos(5) });
  });

  it('deve recomeçar a contagem quando o bloqueio anterior já venceu', () => {
    expect(
      registrarFalhaLogin(
        { tentativasLoginFalhas: 4, bloqueadoAte: minutos(-1) },
        agora,
      ),
    ).toEqual({ tentativasLoginFalhas: 1, bloqueadoAte: null });
  });
});

describe('sessaoExpirada', () => {
  it('não deve expirar quando a inatividade é de até 4 horas (RN04)', () => {
    expect(sessaoExpirada(minutos(-240), agora, 4)).toBe(false);
  });

  it('deve expirar quando a inatividade passa de 4 horas (RN04)', () => {
    expect(sessaoExpirada(minutos(-241), agora, 4)).toBe(true);
  });
});
