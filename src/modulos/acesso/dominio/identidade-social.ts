import { createHash } from 'node:crypto';

/** Login com Google ou Apple (UC-02 FA04, RF46): regras do id_token OpenID Connect. */
export type ProvedorSocial = 'GOOGLE' | 'APPLE';

export interface ClaimsIdentidade {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  exp?: number;
  iat?: number;
  email?: string;
  email_verified?: boolean | string;
  nonce?: string;
  name?: string;
}

export interface IdentidadeSocial {
  provedor: ProvedorSocial;
  idExterno: string;
  email: string;
  nome?: string;
}

export const EMISSORES: Record<ProvedorSocial, string[]> = {
  GOOGLE: ['https://accounts.google.com', 'accounts.google.com'],
  APPLE: ['https://appleid.apple.com'],
};

export const CHAVES_PUBLICAS: Record<ProvedorSocial, string> = {
  GOOGLE: 'https://www.googleapis.com/oauth2/v3/certs',
  APPLE: 'https://appleid.apple.com/auth/keys',
};

/** Margem para relógios fora de sincronia entre a API e o provedor. */
const TOLERANCIA_SEGUNDOS = 60;

const sha256 = (texto: string) =>
  createHash('sha256').update(texto).digest('hex');

/**
 * Confere emissor, público, validade, nonce e e-mail verificado. O nonce aceita o valor puro
 * (Google) ou o SHA-256 dele (Apple, que recebe o hash no pedido de login).
 * Devolve a identidade ou o motivo da recusa.
 */
export function conferirClaims(
  claims: ClaimsIdentidade,
  esperado: {
    provedor: ProvedorSocial;
    audiencias: string[];
    nonce: string;
    agora: Date;
  },
): IdentidadeSocial | { recusa: string } {
  const agora = Math.floor(esperado.agora.getTime() / 1000);
  if (!claims.iss || !EMISSORES[esperado.provedor].includes(claims.iss))
    return { recusa: 'emissor' };
  const audiencias = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiencias.some((a) => a && esperado.audiencias.includes(a)))
    return { recusa: 'publico' };
  if (!claims.exp || claims.exp + TOLERANCIA_SEGUNDOS < agora)
    return { recusa: 'expirado' };
  if (claims.iat && claims.iat - TOLERANCIA_SEGUNDOS > agora)
    return { recusa: 'emitido-no-futuro' };
  if (
    !esperado.nonce ||
    (claims.nonce !== esperado.nonce && claims.nonce !== sha256(esperado.nonce))
  ) {
    return { recusa: 'nonce' };
  }
  if (!claims.sub) return { recusa: 'sem-sub' };
  const verificado =
    claims.email_verified === true || claims.email_verified === 'true';
  if (!claims.email || !verificado) return { recusa: 'email-nao-verificado' };
  return {
    provedor: esperado.provedor,
    idExterno: claims.sub,
    email: claims.email.trim().toLowerCase(),
    nome: claims.name?.trim() || undefined,
  };
}

/** Lista separada por vírgula (os IDs de cliente do Google mudam por plataforma). */
export const listaDeIds = (valor?: string) =>
  (valor ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
