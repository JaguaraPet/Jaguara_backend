/** Acompanhamento das solicitações pelo tutor (UC-42, RN38). */

export type StatusSolicitacao =
  'PENDENTE' | 'ACEITA' | 'RECUSADA' | 'CANCELADA' | 'CONCLUIDA' | 'ENCERRADA';

/**
 * Motivo para não cancelar, ou null se pode. Só pendente ou aceita, e antes do horário
 * (o confirmado no agendamento, ou o desejado enquanto pendente). CT-42-02.
 */
export function motivoParaNaoCancelar(
  s: { status: StatusSolicitacao; horario: Date },
  agora: Date,
): string | null {
  if (s.status !== 'PENDENTE' && s.status !== 'ACEITA') {
    return 'Só dá para cancelar solicitações pendentes ou aceitas.';
  }
  if (s.horario <= agora) {
    return 'O horário desta solicitação já passou e ela não pode mais ser cancelada.';
  }
  return null;
}

/** Quem fez a mudança, do ponto de vista do tutor. */
export function autorDaMudanca(
  autorId: string,
  tutorId: string,
  nomeEmpresa: string,
): string {
  return autorId === tutorId ? 'Você' : nomeEmpresa;
}
