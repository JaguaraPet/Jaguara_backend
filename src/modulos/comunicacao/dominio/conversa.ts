/** Regras do chat (UC-43, RF42, ADR-011) sem dependência de framework. */

export type TipoConversa = 'EMPRESA' | 'ASSISTENTE_VIRTUAL';
export type StatusConversa = 'ABERTA' | 'ENCERRADA';

export const TAMANHO_MAXIMO_MENSAGEM = 4000;

/** Quem pode ver e escrever numa conversa. */
export interface Participante {
  id: string;
  tipo: 'TUTOR' | 'EMPRESA' | 'FUNCIONARIO' | 'ADMINISTRADOR';
  empresaId: string | null;
}

export interface DonoConversa {
  tipo: TipoConversa;
  tutorId: string;
  empresaId: string | null;
}

/** Motivo de recusa ao abrir uma conversa, ou null quando pode abrir. */
export type RecusaInicio =
  | 'SO_TUTOR_INICIA'
  | 'EMPRESA_OBRIGATORIA'
  | 'SEM_VINCULO_EMPRESA'
  | 'SEM_PANTERA'
  | null;

/**
 * CT-43-01 e CT-43-02: o tutor conversa com empresas com quem já tem vínculo
 * (cliente ou agendamento) e com o assistente só com a assinatura PANTERA ativa (RN25).
 */
export function podeIniciar(
  quem: Participante,
  pedido: { tipo: TipoConversa; empresaId?: string },
  situacao: { temVinculoEmpresa: boolean; temPantera: boolean },
): RecusaInicio {
  if (quem.tipo !== 'TUTOR') return 'SO_TUTOR_INICIA';
  if (pedido.tipo === 'EMPRESA') {
    if (!pedido.empresaId) return 'EMPRESA_OBRIGATORIA';
    return situacao.temVinculoEmpresa ? null : 'SEM_VINCULO_EMPRESA';
  }
  return situacao.temPantera ? null : 'SEM_PANTERA';
}

/** O tutor dono vê a conversa; na empresa, qualquer usuário da empresa com chat:usar. */
export function participa(quem: Participante, conversa: DonoConversa): boolean {
  if (quem.tipo === 'TUTOR') return conversa.tutorId === quem.id;
  if (quem.tipo === 'EMPRESA' || quem.tipo === 'FUNCIONARIO') {
    return (
      conversa.tipo === 'EMPRESA' &&
      quem.empresaId !== null &&
      conversa.empresaId === quem.empresaId
    );
  }
  return false;
}

/** Tira espaços das pontas e recusa mensagem vazia ou longa demais. */
export function normalizarConteudo(
  conteudo: unknown,
): { ok: true; texto: string } | { ok: false; motivo: string } {
  if (typeof conteudo !== 'string')
    return { ok: false, motivo: 'Escreva a mensagem.' };
  const texto = conteudo.trim();
  if (!texto) return { ok: false, motivo: 'Escreva a mensagem.' };
  if (texto.length > TAMANHO_MAXIMO_MENSAGEM) {
    return {
      ok: false,
      motivo: `A mensagem pode ter até ${TAMANHO_MAXIMO_MENSAGEM} caracteres.`,
    };
  }
  return { ok: true, texto };
}

/**
 * Assinatura vigente: ATIVA, ou CANCELADA ainda dentro do período pago (o cancelamento só
 * impede a próxima cobrança), sem fim ou com fim a partir de hoje.
 */
export function assinaturaVigente(
  a: { plano: string; status: string; dataFim: Date | null },
  hoje: Date,
): boolean {
  if (a.plano !== 'PANTERA') return false;
  if (a.status !== 'ATIVA' && a.status !== 'CANCELADA') return false;
  if (!a.dataFim) return a.status === 'ATIVA';
  return (
    a.dataFim.toISOString().slice(0, 10) >= hoje.toISOString().slice(0, 10)
  );
}

/** Salas do Socket.IO (ADR-011): uma por usuário e uma por empresa. */
export const salaUsuario = (id: string) => `usuario:${id}`;
export const salaEmpresa = (id: string) => `empresa:${id}`;

/** Salas que recebem uma mensagem nova da conversa. */
export function salasDaConversa(conversa: DonoConversa): string[] {
  const salas = [salaUsuario(conversa.tutorId)];
  if (conversa.tipo === 'EMPRESA' && conversa.empresaId)
    salas.push(salaEmpresa(conversa.empresaId));
  return salas;
}
