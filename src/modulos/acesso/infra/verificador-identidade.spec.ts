import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { conferirClaims } from '../dominio/identidade-social';
import { VerificadorIdentidade } from './verificador-identidade';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' };
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

function token(claims: object, kid = 'k1') {
  const corpo = `${b64({ alg: 'RS256', kid })}.${b64(claims)}`;
  return `${corpo}.${sign('RSA-SHA256', Buffer.from(corpo), privateKey).toString('base64url')}`;
}

const agora = new Date('2026-11-17T12:00:00Z');
const seg = Math.floor(agora.getTime() / 1000);
const google = {
  iss: 'https://accounts.google.com',
  aud: 'cliente.apps.googleusercontent.com',
  sub: '1234567890',
  exp: seg + 600,
  iat: seg,
  email: 'Ana@Gmail.com',
  email_verified: true,
  nonce: 'n-123',
  name: 'Ana Ribeiro',
};

describe('Login social: id_token do provedor (UC-02 FA04, RF46)', () => {
  const buscar = jest.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }),
    ),
  );
  const verificador = new VerificadorIdentidade(buscar);

  it('deve aceitar o token assinado pela chave do provedor e guardar as chaves em cache', async () => {
    await expect(
      verificador.verificar('GOOGLE', token(google)),
    ).resolves.toMatchObject({ sub: '1234567890' });
    await verificador.verificar('GOOGLE', token(google));
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it('deve recusar assinatura adulterada, chave desconhecida e formato inválido', async () => {
    const [cab, , ass] = token(google).split('.');
    await expect(
      verificador.verificar(
        'GOOGLE',
        `${cab}.${b64({ ...google, sub: 'outro' })}.${ass}`,
      ),
    ).resolves.toBeNull();
    await expect(
      verificador.verificar('GOOGLE', token(google, 'k-desconhecida')),
    ).resolves.toBeNull();
    await expect(
      verificador.verificar('GOOGLE', 'nao-e-jwt'),
    ).resolves.toBeNull();
  });

  it('deve conferir emissor, público, validade, nonce e e-mail verificado', () => {
    const esperado = {
      provedor: 'GOOGLE' as const,
      audiencias: ['cliente.apps.googleusercontent.com'],
      nonce: 'n-123',
      agora,
    };
    expect(conferirClaims(google, esperado)).toEqual({
      provedor: 'GOOGLE',
      idExterno: '1234567890',
      email: 'ana@gmail.com',
      nome: 'Ana Ribeiro',
    });
    expect(
      conferirClaims({ ...google, iss: 'https://outro.com' }, esperado),
    ).toEqual({ recusa: 'emissor' });
    expect(conferirClaims({ ...google, aud: 'outro-app' }, esperado)).toEqual({
      recusa: 'publico',
    });
    expect(conferirClaims({ ...google, exp: seg - 3600 }, esperado)).toEqual({
      recusa: 'expirado',
    });
    expect(conferirClaims({ ...google, nonce: 'outro' }, esperado)).toEqual({
      recusa: 'nonce',
    });
    expect(
      conferirClaims({ ...google, email_verified: false }, esperado),
    ).toEqual({ recusa: 'email-nao-verificado' });
  });

  it('deve aceitar o nonce em SHA-256 da Apple', () => {
    const apple = {
      iss: 'https://appleid.apple.com',
      aud: 'br.com.jaguarapet.app',
      sub: '001.abc',
      exp: seg + 600,
      email: 'ana@privaterelay.appleid.com',
      email_verified: 'true',
      nonce: 'hash-de-outro-nonce',
    };
    const esperado = {
      provedor: 'APPLE' as const,
      audiencias: ['br.com.jaguarapet.app'],
      nonce: 'n-123',
      agora,
    };
    expect(conferirClaims(apple, esperado)).toEqual({ recusa: 'nonce' });
    const hash = createHash('sha256').update('n-123').digest('hex');
    expect(conferirClaims({ ...apple, nonce: hash }, esperado)).toMatchObject({
      provedor: 'APPLE',
      idExterno: '001.abc',
    });
  });
});
