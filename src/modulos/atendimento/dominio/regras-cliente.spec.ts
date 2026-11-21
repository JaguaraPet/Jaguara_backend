import {
  codigoCliente,
  preCadastroVencido,
  situacaoConsentimento,
} from './regras-cliente';

describe('regras do cliente', () => {
  it('deve indicar a situação do consentimento (RN41)', () => {
    expect(situacaoConsentimento(null)).toBe('PENDENTE');
    expect(situacaoConsentimento({ aceito: false, dataRevogacao: null })).toBe(
      'PENDENTE',
    );
    expect(situacaoConsentimento({ aceito: true, dataRevogacao: null })).toBe(
      'VIGENTE',
    );
    expect(
      situacaoConsentimento({ aceito: false, dataRevogacao: new Date() }),
    ).toBe('REVOGADO');
  });

  it('deve vencer o pré-cadastro depois de 7 dias (RN41)', () => {
    const cadastro = new Date('2026-11-19T12:00:00Z');
    expect(preCadastroVencido(cadastro, new Date('2026-11-26T12:00:00Z'))).toBe(
      false,
    );
    expect(preCadastroVencido(cadastro, new Date('2026-11-26T12:00:01Z'))).toBe(
      true,
    );
  });

  it('deve gerar o código sequencial do cliente', () => {
    expect(codigoCliente(7)).toBe('CLI-0007');
  });
});
