import {
  cnpjValido,
  normalizarEmail,
  problemaNaSenha,
  tokenUtilizavel,
} from './regras-cadastro';

describe('regras de cadastro', () => {
  it('deve normalizar o e-mail quando vem com maiúsculas e espaços', () => {
    expect(normalizarEmail('  Ana@Exemplo.COM ')).toBe('ana@exemplo.com');
  });

  it('deve aceitar a senha quando tem 8 caracteres com letras e números', () => {
    expect(problemaNaSenha('senha123')).toBeNull();
  });

  it('deve recusar a senha quando é curta', () => {
    expect(problemaNaSenha('a1b2')).toContain('8 caracteres');
  });

  it('deve recusar a senha quando não tem número', () => {
    expect(problemaNaSenha('somenteletras')).toContain('letras e números');
  });

  it('deve validar os dígitos do CNPJ quando confere a empresa (RN01)', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true);
    expect(cnpjValido('11222333000180')).toBe(false);
    expect(cnpjValido('00000000000000')).toBe(false);
  });

  it('deve aceitar o token de confirmação só quando não foi usado e não venceu (RN02)', () => {
    const agora = new Date('2026-11-19T12:00:00Z');
    const depois = new Date('2026-11-19T13:00:00Z');
    expect(tokenUtilizavel({ utilizado: false, expiraEm: depois }, agora)).toBe(
      true,
    );
    expect(tokenUtilizavel({ utilizado: true, expiraEm: depois }, agora)).toBe(
      false,
    );
    expect(tokenUtilizavel({ utilizado: false, expiraEm: agora }, agora)).toBe(
      false,
    );
  });
});
