export interface Coordenadas {
  latitude: number;
  longitude: number;
}

const RAIO_TERRA_KM = 6371;
const rad = (graus: number) => (graus * Math.PI) / 180;

/** Distância em linha reta (haversine), em km com uma casa decimal. */
export function distanciaKm(a: Coordenadas, b: Coordenadas): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(dLon / 2) ** 2;
  const km = 2 * RAIO_TERRA_KM * Math.asin(Math.sqrt(h));
  return Math.round(km * 10) / 10;
}

export function coordenadasValidas(lat?: number, lon?: number): boolean {
  return (
    lat !== undefined &&
    lon !== undefined &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  );
}

export const apenasDigitosCep = (cep: string) =>
  cep.replace(/\D/g, '').slice(0, 8);
