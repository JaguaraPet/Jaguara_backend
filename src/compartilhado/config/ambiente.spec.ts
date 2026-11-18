import { validarAmbiente } from './ambiente';

const valido = {
  DATABASE_URL: 'postgresql://jaguara:jaguara@localhost:5432/jaguara',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(40),
  CHAVE_CRIPTOGRAFIA: Buffer.alloc(32, 1).toString('base64'),
  S3_ENDPOINT: 'http://localhost:8333',
  S3_BUCKET: 'jaguara-arquivos',
  S3_ACCESS_KEY: 'chave',
  S3_SECRET_KEY: 'segredo',
  EMAIL_REMETENTE: 'Jaguara <nao-responda@jaguarapet.com.br>',
  URL_WEB: 'http://localhost:5173',
  URL_APP: 'jaguara://',
};

describe('validarAmbiente', () => {
  it('aceita a configuração mínima e aplica os padrões', () => {
    const ambiente = validarAmbiente(valido);
    expect(ambiente.PORT).toBe(3000);
    expect(ambiente.JWT_EXPIRACAO_MINUTOS).toBe(15);
    expect(ambiente.SESSAO_INATIVIDADE_HORAS).toBe(4);
  });

  it('recusa JWT_SECRET curto', () => {
    expect(() => validarAmbiente({ ...valido, JWT_SECRET: 'curto' })).toThrow(
      /JWT_SECRET/,
    );
  });

  it('recusa chave de criptografia que não tem 32 bytes', () => {
    expect(() =>
      validarAmbiente({
        ...valido,
        CHAVE_CRIPTOGRAFIA: Buffer.alloc(16).toString('base64'),
      }),
    ).toThrow(/CHAVE_CRIPTOGRAFIA/);
  });
});
