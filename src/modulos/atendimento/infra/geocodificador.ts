import { Logger } from '@nestjs/common';
import { apenasDigitosCep, type Coordenadas } from '../dominio/distancia';

/** Descobre as coordenadas aproximadas de um CEP. */
export abstract class Geocodificador {
  abstract doCep(cep: string): Promise<Coordenadas | null>;
}

/**
 * Coordenadas pela BrasilAPI (CEP v2), base pública e gratuita. Guarda em memória o que já
 * consultou; falha ou CEP sem coordenadas devolve null e a empresa vai para o fim da lista.
 */
export class GeocodificadorBrasilApi extends Geocodificador {
  private readonly log = new Logger(GeocodificadorBrasilApi.name);
  private readonly cache = new Map<string, Coordenadas | null>();

  constructor(private readonly http: typeof fetch = (...a) => fetch(...a)) {
    super();
  }

  async doCep(cep: string): Promise<Coordenadas | null> {
    const digitos = apenasDigitosCep(cep);
    if (digitos.length !== 8) return null;
    if (this.cache.has(digitos)) return this.cache.get(digitos)!;
    try {
      const resposta = await this.http(
        `https://brasilapi.com.br/api/cep/v2/${digitos}`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (!resposta.ok) {
        if (resposta.status === 404) this.cache.set(digitos, null);
        return null;
      }
      const corpo = (await resposta.json()) as {
        location?: { coordinates?: { latitude?: string; longitude?: string } };
      };
      const lat = Number(corpo.location?.coordinates?.latitude);
      const lon = Number(corpo.location?.coordinates?.longitude);
      const coordenadas =
        Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)
          ? { latitude: lat, longitude: lon }
          : null;
      this.cache.set(digitos, coordenadas);
      return coordenadas;
    } catch (erro) {
      this.log.warn(`CEP ${digitos} sem coordenadas agora: ${String(erro)}`);
      return null;
    }
  }
}

/**
 * Para testes e desenvolvimento sem internet: coordenadas fixas a partir do CEP, em volta do
 * centro de São Paulo (cada número a mais no CEP afasta um pouco).
 */
export class GeocodificadorSimulado extends Geocodificador {
  doCep(cep: string): Promise<Coordenadas | null> {
    const digitos = apenasDigitosCep(cep);
    if (digitos.length !== 8) return Promise.resolve(null);
    const n = Number(digitos.slice(2, 5));
    return Promise.resolve({
      latitude: -23.55 - n / 10000,
      longitude: -46.63 - n / 10000,
    });
  }
}

/** Nos testes e com GEOCODIFICADOR=simulado, sem chamada externa. */
export function criarGeocodificador(): Geocodificador {
  return process.env.NODE_ENV === 'test' ||
    process.env.GEOCODIFICADOR === 'simulado'
    ? new GeocodificadorSimulado()
    : new GeocodificadorBrasilApi();
}
