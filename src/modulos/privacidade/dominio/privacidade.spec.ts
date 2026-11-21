import {
  aceiteVigente,
  emailAnonimo,
  hashAnonimo,
  termosDaConta,
} from './privacidade';

describe('privacidade (UC-46, RN42)', () => {
  it('deve mostrar a cada conta só os termos que ela aceita', () => {
    expect(termosDaConta('TUTOR')).toContain('TERMOS_USO_APP');
    expect(termosDaConta('TUTOR')).not.toContain('TERMOS_ENTERPRISE');
    expect(termosDaConta('FUNCIONARIO')).toContain('TERMOS_ENTERPRISE');
    expect(termosDaConta('ADMINISTRADOR')).toEqual(['POLITICA_PRIVACIDADE']);
  });

  it('deve considerar o último registro e a revogação', () => {
    const ontem = new Date('2026-11-20T12:00:00Z');
    const hoje = new Date('2026-11-21T12:00:00Z');
    expect(aceiteVigente([])).toEqual({ aceito: false });
    expect(
      aceiteVigente([{ aceito: true, dataAceite: ontem, dataRevogacao: null }]),
    ).toEqual({ aceito: true, dataAceite: ontem });
    expect(
      aceiteVigente([{ aceito: true, dataAceite: ontem, dataRevogacao: hoje }]),
    ).toEqual({ aceito: false });
    expect(
      aceiteVigente([
        { aceito: true, dataAceite: ontem, dataRevogacao: hoje },
        { aceito: true, dataAceite: hoje, dataRevogacao: null },
      ]),
    ).toEqual({ aceito: true, dataAceite: hoje });
  });

  it('deve gerar identificadores anônimos estáveis e sem dado pessoal', () => {
    expect(emailAnonimo('u1')).toBe('excluido-u1@anonimo.jaguara');
    expect(hashAnonimo('u1')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAnonimo('u1')).not.toBe(hashAnonimo('u2'));
  });
});
