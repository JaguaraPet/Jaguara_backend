import { Injectable, Logger } from '@nestjs/common';
import { createPublicKey, verify } from 'node:crypto';
import type { JsonWebKey } from 'node:crypto';
import { CHAVES_PUBLICAS } from '../dominio/identidade-social';
import type {
  ClaimsIdentidade,
  ProvedorSocial,
} from '../dominio/identidade-social';

type Jwk = JsonWebKey & { kid?: string; alg?: string };

/** As chaves dos provedores mudam raramente; uma hora de cache evita uma consulta por login. */
const CACHE_MS = 60 * 60 * 1000;

const decodificar = <T>(parte: string): T =>
  JSON.parse(Buffer.from(parte, 'base64url').toString('utf8')) as T;

/**
 * Confere a assinatura RS256 do id_token com as chaves públicas (JWKS) do Google ou da Apple,
 * só com o node:crypto. Devolve as claims para a regra de negócio conferir o resto.
 */
@Injectable()
export class VerificadorIdentidade {
  private readonly log = new Logger(VerificadorIdentidade.name);
  private readonly cache = new Map<
    ProvedorSocial,
    { chaves: Jwk[]; ate: number }
  >();

  constructor(private readonly buscar: typeof fetch = fetch) {}

  async verificar(
    provedor: ProvedorSocial,
    idToken: string,
  ): Promise<ClaimsIdentidade | null> {
    const partes = idToken.split('.');
    if (partes.length !== 3) return null;
    let cabecalho: { alg?: string; kid?: string };
    try {
      cabecalho = decodificar(partes[0]);
    } catch {
      return null;
    }
    if (cabecalho.alg !== 'RS256' || !cabecalho.kid) return null;

    let chave = (await this.chaves(provedor)).find(
      (c) => c.kid === cabecalho.kid,
    );
    if (!chave) {
      // Chave nova publicada pelo provedor: busca de novo antes de recusar.
      this.cache.delete(provedor);
      chave = (await this.chaves(provedor)).find(
        (c) => c.kid === cabecalho.kid,
      );
    }
    if (!chave) return null;

    const valido = verify(
      'RSA-SHA256',
      Buffer.from(`${partes[0]}.${partes[1]}`),
      createPublicKey({ key: chave, format: 'jwk' }),
      Buffer.from(partes[2], 'base64url'),
    );
    if (!valido) return null;
    try {
      return decodificar<ClaimsIdentidade>(partes[1]);
    } catch {
      return null;
    }
  }

  private async chaves(provedor: ProvedorSocial): Promise<Jwk[]> {
    const guardadas = this.cache.get(provedor);
    if (guardadas && guardadas.ate > Date.now()) return guardadas.chaves;
    try {
      const resposta = await this.buscar(CHAVES_PUBLICAS[provedor]);
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      const { keys } = (await resposta.json()) as { keys: Jwk[] };
      this.cache.set(provedor, { chaves: keys, ate: Date.now() + CACHE_MS });
      return keys;
    } catch (erro) {
      this.log.warn(
        `Chaves públicas de ${provedor} indisponíveis: ${String(erro)}`,
      );
      return guardadas?.chaves ?? [];
    }
  }
}
