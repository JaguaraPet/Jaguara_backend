import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';

export type OrigemNotificacao =
  'VACINACAO' | 'TRATAMENTO' | 'EVENTO' | 'ALIMENTACAO' | 'AGENDAMENTO';

export interface NovaNotificacao {
  destinatarioId: string;
  titulo: string;
  mensagem: string;
  dataProgramada: Date;
  origemTipo: OrigemNotificacao;
  origemId: string;
}

/**
 * Agenda as notificações automáticas na tabela `notificacao` (status AGENDADA). O worker
 * dispara as que vencem (UC-31, DS-06); cancelar a origem cancela os lembretes pendentes.
 */
@Injectable()
export class AgendaNotificacoesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Tutores responsáveis ativos do pet: quem recebe os lembretes (RN18). */
  async responsaveisDoPet(petId: string): Promise<string[]> {
    const responsaveis = await this.prisma.responsavelPet.findMany({
      where: { petId, ativo: true },
      select: { tutorId: true },
    });
    return responsaveis.map((r) => r.tutorId);
  }

  async agendar(notificacoes: NovaNotificacao[]): Promise<number> {
    if (notificacoes.length === 0) return 0;
    const { count } = await this.prisma.notificacao.createMany({
      data: notificacoes.map((n) => ({
        ...n,
        canal: 'PUSH' as const,
        status: 'AGENDADA' as const,
        tentativas: 0,
      })),
    });
    return count;
  }

  /** CT-14-02: cancela os lembretes ainda não enviados de uma origem. */
  async cancelar(
    origemTipo: OrigemNotificacao,
    origemId: string,
  ): Promise<number> {
    const { count } = await this.prisma.notificacao.updateMany({
      where: { origemTipo, origemId, status: 'AGENDADA' },
      data: { status: 'CANCELADA' },
    });
    return count;
  }
}
