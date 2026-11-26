/** Chamados de suporte (UC-26, RN32). */
export type StatusChamado =
  'ABERTO' | 'EM_ANALISE' | 'AGUARDANDO_INFORMACAO' | 'RESOLVIDO' | 'FECHADO';

/** Status que o administrador escolhe ao registrar uma intervenção. */
export type StatusIntervencao = 'EM_ANALISE' | 'RESOLVIDO' | 'FECHADO';

export const STATUS_CHAMADO: StatusChamado[] = [
  'ABERTO',
  'EM_ANALISE',
  'AGUARDANDO_INFORMACAO',
  'RESOLVIDO',
  'FECHADO',
];

const ROTULO: Record<StatusChamado, string> = {
  ABERTO: 'aberto',
  EM_ANALISE: 'em análise',
  AGUARDANDO_INFORMACAO: 'aguardando informação',
  RESOLVIDO: 'resolvido',
  FECHADO: 'fechado',
};

export const rotuloStatus = (s: StatusChamado) => ROTULO[s];

/** Chamado fechado não recebe mais nada; o resolvido ainda pode ser fechado ou reaberto pelo suporte. */
export const aceitaIntervencao = (s: StatusChamado) => s !== 'FECHADO';

/** O solicitante só complementa quando o suporte pediu informação (CT-26-02). */
export const aceitaComplemento = (s: StatusChamado) =>
  s === 'AGUARDANDO_INFORMACAO';

export const encerra = (s: StatusChamado) =>
  s === 'RESOLVIDO' || s === 'FECHADO';

/** Protocolo legível para o usuário citar no contato: SUP-AAAAMMDD-XXXXX. */
export function gerarProtocolo(
  agora: Date,
  aleatorio: () => number = Math.random,
): string {
  const data = agora.toISOString().slice(0, 10).replace(/-/g, '');
  const sufixo = Math.floor(aleatorio() * 36 ** 5)
    .toString(36)
    .toUpperCase()
    .padStart(5, '0');
  return `SUP-${data}-${sufixo}`;
}

/** Junta o complemento do solicitante à descrição, com a data, sem perder o texto original. */
export function comComplemento(
  descricao: string,
  mensagem: string,
  quando: Date,
): string {
  const data = quando.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
  });
  return `${descricao}\n\n[Complemento em ${data}]\n${mensagem.trim()}`;
}
