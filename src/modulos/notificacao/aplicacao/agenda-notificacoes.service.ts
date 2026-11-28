import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { configuracaoEfetiva, programar } from '../dominio/programacao';
import type { Configuracao, TipoEvento } from '../dominio/programacao';

export type OrigemNotificacao =
  | 'VACINACAO'
  | 'TRATAMENTO'
  | 'EVENTO'
  | 'ALIMENTACAO'
  | 'AGENDAMENTO'
  | 'ROTINA';

export interface NovaNotificacao {
  destinatarioId: string;
  titulo: string;
  mensagem: string;
  /** Quando o compromisso acontece; a antecedência do usuário é descontada (RN37). */
  dataReferencia: Date;
  tipoEvento: TipoEvento;
  origemTipo: OrigemNotificacao;
  origemId: string;
  /** Antecedência fixa, para lembretes com hora certa (ex.: 24 h e 2 h antes do agendamento). */
  antecedenciaMinutos?: number;
}

/**
 * Agenda as notificações automáticas na tabela `notificacao` (status AGENDADA) com o canal e
 * a antecedência que cada destinatário configurou (RN37, DS-06). O worker dispara as que
 * vencem; cancelar a origem cancela os lembretes pendentes.
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
    const configuracoes = await this.prisma.configuracaoNotificacao.findMany({
      where: {
        usuarioId: {
          in: [...new Set(notificacoes.map((n) => n.destinatarioId))],
        },
      },
    });
    const porChave = new Map<string, Configuracao>(
      configuracoes.map((c) => [`${c.usuarioId}:${c.tipoEvento}`, c]),
    );
    const agora = new Date();
    const dados = notificacoes.flatMap((n) => {
      const configuracao = configuracaoEfetiva(
        n.tipoEvento,
        porChave.get(`${n.destinatarioId}:${n.tipoEvento}`),
      );
      const dataProgramada = programar(
        n.dataReferencia,
        n.antecedenciaMinutos === undefined
          ? configuracao
          : { ...configuracao, antecedenciaMinutos: n.antecedenciaMinutos },
        agora,
      );
      if (!dataProgramada) return [];
      return [
        {
          destinatarioId: n.destinatarioId,
          titulo: n.titulo,
          mensagem: n.mensagem,
          origemTipo: n.origemTipo,
          origemId: n.origemId,
          dataProgramada,
          canal: configuracao.canal,
          status: 'AGENDADA' as const,
          tentativas: 0,
        },
      ];
    });
    if (dados.length === 0) return 0;
    const { count } = await this.prisma.notificacao.createMany({ data: dados });
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
