import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import {
  AgendaNotificacoesService,
  NovaNotificacao,
} from '../../notificacao/aplicacao/agenda-notificacoes.service';
import type { TipoEvento } from '../../notificacao/dominio/programacao';

/** Lembretes do agendamento: um dia antes e duas horas antes. */
export const LEMBRETES_AGENDAMENTO = [
  { minutos: 24 * 60, quando: 'Amanhã' },
  { minutos: 2 * 60, quando: 'Daqui a 2 horas' },
] as const;

const TIPO_POR_CATEGORIA: Partial<Record<string, TipoEvento>> = {
  CONSULTA: 'CONSULTA',
  VACINACAO: 'VACINA',
  EXAME: 'EXAME',
  CIRURGIA: 'CIRURGIA',
  BANHO_TOSA: 'BANHO_TOSA',
  HOSPEDAGEM: 'HOSPEDAGEM',
  CRECHE: 'HOSPEDAGEM',
};

/**
 * Programa os lembretes do agendamento com a empresa para todos os responsáveis do pet, com a
 * confirmação de presença no app. Falta é a maior dor do pet shop pequeno; o lembrete com
 * confirmação é o que a reduz.
 */
@Injectable()
export class LembretesAgendamentoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificacoes: AgendaNotificacoesService,
  ) {}

  async programar(agendamentoId: string): Promise<number> {
    const a = await this.prisma.agendamento.findUnique({
      where: { id: agendamentoId },
      include: {
        pet: { select: { nome: true } },
        servico: {
          select: {
            nome: true,
            categoria: true,
            empresa: { select: { nomeFantasia: true } },
          },
        },
      },
    });
    if (!a || a.status !== 'AGENDADO') return 0;
    const destinatarios = await this.notificacoes.responsaveisDoPet(a.petId);
    const hora = a.dataHoraInicio.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });
    const lista: NovaNotificacao[] = destinatarios.flatMap((destinatarioId) =>
      LEMBRETES_AGENDAMENTO.map((l) => ({
        destinatarioId,
        titulo: `${l.quando}: ${a.servico.nome} do ${a.pet.nome}`,
        mensagem: `Às ${hora} na ${a.servico.empresa.nomeFantasia}. Confirme sua presença no app; se não puder ir, avise a clínica.`,
        dataReferencia: a.dataHoraInicio,
        tipoEvento: TIPO_POR_CATEGORIA[a.servico.categoria] ?? 'COMPROMISSO',
        origemTipo: 'AGENDAMENTO' as const,
        origemId: a.id,
        antecedenciaMinutos: l.minutos,
      })),
    );
    return this.notificacoes.agendar(lista);
  }

  async cancelar(agendamentoId: string): Promise<number> {
    return this.notificacoes.cancelar('AGENDAMENTO', agendamentoId);
  }

  async reprogramar(agendamentoId: string): Promise<number> {
    await this.cancelar(agendamentoId);
    return this.programar(agendamentoId);
  }
}
