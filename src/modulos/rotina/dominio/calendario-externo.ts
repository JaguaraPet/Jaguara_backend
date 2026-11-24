import { createHmac, timingSafeEqual } from 'node:crypto';

/** Sincronização com calendário externo (UC-09, RN13). */

export interface EventoExterno {
  idExterno: string;
  titulo: string;
  descricao?: string;
  local?: string;
  inicio: Date;
  fim?: Date;
}

/** Validade do pedido de autorização: o tutor tem 10 minutos para aceitar no Google. */
export const VALIDADE_ESTADO_MS = 10 * 60 * 1000;

const b64 = (texto: string) => Buffer.from(texto).toString('base64url');

/**
 * Estado do OAuth assinado: liga o retorno do provedor ao tutor que pediu, sem guardar nada
 * no servidor, e expira em 10 minutos.
 */
export function assinarEstado(
  usuarioId: string,
  segredo: string,
  agora = Date.now(),
): string {
  const corpo = b64(
    JSON.stringify({ u: usuarioId, e: agora + VALIDADE_ESTADO_MS }),
  );
  const assinatura = createHmac('sha256', segredo)
    .update(corpo)
    .digest('base64url');
  return `${corpo}.${assinatura}`;
}

/** Id do tutor se o estado é autêntico e está no prazo; senão, null. */
export function verificarEstado(
  estado: string,
  segredo: string,
  agora = Date.now(),
): string | null {
  const [corpo, assinatura] = estado.split('.');
  if (!corpo || !assinatura) return null;
  const esperada = createHmac('sha256', segredo).update(corpo).digest();
  const recebida = Buffer.from(assinatura, 'base64url');
  if (
    recebida.length !== esperada.length ||
    !timingSafeEqual(recebida, esperada)
  ) {
    return null;
  }
  try {
    const dados = JSON.parse(Buffer.from(corpo, 'base64url').toString()) as {
      u?: string;
      e?: number;
    };
    return dados.u && dados.e && dados.e > agora ? dados.u : null;
  } catch {
    return null;
  }
}

/**
 * Diferença entre o que já foi importado para o pet e o que está no calendário externo:
 * cria os novos, atualiza os existentes e remove os que saíram do calendário.
 */
export function mesclar(
  importados: { id: string; idExterno: string | null }[],
  externos: EventoExterno[],
): {
  criar: EventoExterno[];
  atualizar: { id: string; evento: EventoExterno }[];
  remover: string[];
} {
  const porIdExterno = new Map(
    importados.filter((i) => i.idExterno).map((i) => [i.idExterno!, i.id]),
  );
  const vistos = new Set<string>();
  const criar: EventoExterno[] = [];
  const atualizar: { id: string; evento: EventoExterno }[] = [];
  for (const evento of externos) {
    if (vistos.has(evento.idExterno)) continue;
    vistos.add(evento.idExterno);
    const id = porIdExterno.get(evento.idExterno);
    if (id) atualizar.push({ id, evento });
    else criar.push(evento);
  }
  const remover = importados
    .filter((i) => !i.idExterno || !vistos.has(i.idExterno))
    .map((i) => i.id);
  return { criar, atualizar, remover };
}
