import { Injectable } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { AgendaNotificacoesService } from '../../notificacao/aplicacao/agenda-notificacoes.service';
import { PoliticaAcessoPet } from '../../pet/aplicacao/politica-acesso-pet';
import {
  cruzam,
  fimDoEvento,
  horarioDoLembrete,
  tipoDaCategoria,
} from '../dominio/evento';
import type { TipoEvento } from '../dominio/evento';

export interface Evento {
  id: string;
  titulo: string;
  descricao?: string;
  tipo: TipoEvento;
  dataHoraInicio: string;
  dataHoraFim?: string;
  local?: string;
  origem: 'MANUAL' | 'AGENDAMENTO' | 'CALENDARIO_EXTERNO';
}

/** Período padrão da consulta: de hoje a 30 dias. */
const JANELA_PADRAO_MS = 30 * 86_400_000;

/** Calendário do pet (UC-10): eventos do tutor e agendamentos com empresas. */
@Injectable()
export class EventosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly politicaPet: PoliticaAcessoPet,
    private readonly agenda: AgendaNotificacoesService,
  ) {}

  /** Eventos e agendamentos ativos do período, em ordem de início. */
  async listar(
    usuario: UsuarioAutenticado,
    petId: string,
    filtro: { de?: string; ate?: string },
  ): Promise<Evento[]> {
    await this.garantirResponsavel(usuario, petId);
    const de = filtro.de ? new Date(filtro.de) : new Date();
    const ate = filtro.ate
      ? new Date(filtro.ate)
      : new Date(de.getTime() + JANELA_PADRAO_MS);
    const [eventos, agendamentos] = await Promise.all([
      this.prisma.eventoCalendario.findMany({
        where: { petId, dataHoraInicio: { gte: de, lt: ate } },
      }),
      this.prisma.agendamento.findMany({
        where: {
          petId,
          status: 'AGENDADO',
          dataHoraInicio: { gte: de, lt: ate },
        },
        include: {
          servico: {
            select: {
              nome: true,
              categoria: true,
              empresa: { select: { nomeFantasia: true } },
            },
          },
        },
      }),
    ]);
    return [
      ...eventos.map((e) => this.resposta(e)),
      ...agendamentos.map((a): Evento => ({
        id: a.id,
        titulo: a.servico.nome,
        tipo: tipoDaCategoria(a.servico.categoria),
        dataHoraInicio: a.dataHoraInicio.toISOString(),
        dataHoraFim: a.dataHoraFim.toISOString(),
        local: a.servico.empresa.nomeFantasia,
        origem: 'AGENDAMENTO',
      })),
    ].sort((a, b) => a.dataHoraInicio.localeCompare(b.dataHoraInicio));
  }

  /**
   * CT-10-01 e CT-10-02: o pet não fica em dois compromissos ao mesmo tempo (RN14); o evento
   * criado agenda o lembrete para os responsáveis uma hora antes (RN37).
   */
  async criar(
    usuario: UsuarioAutenticado,
    petId: string,
    dados: {
      titulo: string;
      descricao?: string;
      tipo: TipoEvento;
      dataHoraInicio: string;
      dataHoraFim?: string;
      local?: string;
    },
  ): Promise<Evento> {
    await this.garantirResponsavel(usuario, petId);
    const inicio = new Date(dados.dataHoraInicio);
    const fim = fimDoEvento(
      inicio,
      dados.dataHoraFim ? new Date(dados.dataHoraFim) : null,
    );
    if (fim <= inicio) {
      throw Erros.dadosInvalidos(
        'dataHoraFim',
        'O fim precisa ser depois do início.',
      );
    }
    await this.garantirSemConflito(petId, { inicio, fim });

    const criado = await this.prisma.eventoCalendario.create({
      data: {
        petId,
        criadoPorId: usuario.sub,
        titulo: dados.titulo.trim(),
        descricao: dados.descricao?.trim() || null,
        tipo: dados.tipo,
        dataHoraInicio: inicio,
        dataHoraFim: dados.dataHoraFim ? fim : null,
        local: dados.local?.trim() || null,
        origem: 'MANUAL',
      },
      include: { pet: { select: { nome: true } } },
    });

    const quando = horarioDoLembrete(inicio, new Date());
    if (quando) {
      const destinatarios = await this.agenda.responsaveisDoPet(petId);
      const hora = inicio.toLocaleTimeString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
      });
      await this.agenda.agendar(
        destinatarios.map((destinatarioId) => ({
          destinatarioId,
          titulo: `${criado.titulo} às ${hora}`,
          mensagem: `Compromisso de ${criado.pet.nome}${criado.local ? ` em ${criado.local}` : ''}.`,
          dataProgramada: quando,
          origemTipo: 'EVENTO',
          origemId: criado.id,
        })),
      );
    }
    return this.resposta(criado);
  }

  /** Exclui um evento manual e cancela o lembrete pendente. */
  async excluir(usuario: UsuarioAutenticado, eventoId: string): Promise<void> {
    const evento = await this.prisma.eventoCalendario.findUnique({
      where: { id: eventoId },
    });
    if (!evento) throw Erros.naoEncontrado('Evento não encontrado');
    await this.garantirResponsavel(usuario, evento.petId);
    if (evento.origem !== 'MANUAL') {
      throw Erros.conflito(
        'EVENTO_EXTERNO',
        'Este evento vem de um agendamento ou de outro calendário.',
      );
    }
    await this.prisma.eventoCalendario.delete({ where: { id: eventoId } });
    await this.agenda.cancelar('EVENTO', eventoId);
  }

  private async garantirSemConflito(
    petId: string,
    novo: { inicio: Date; fim: Date },
  ) {
    // Eventos podem durar horas: confere os que começaram até um dia antes.
    const desde = new Date(novo.inicio.getTime() - 86_400_000);
    const [eventos, agendamentos] = await Promise.all([
      this.prisma.eventoCalendario.findMany({
        where: { petId, dataHoraInicio: { gte: desde, lt: novo.fim } },
        select: { dataHoraInicio: true, dataHoraFim: true },
      }),
      this.prisma.agendamento.count({
        where: {
          petId,
          status: 'AGENDADO',
          dataHoraInicio: { lt: novo.fim },
          dataHoraFim: { gt: novo.inicio },
        },
      }),
    ]);
    const ocupado =
      agendamentos > 0 ||
      eventos.some((e) =>
        cruzam(novo, {
          inicio: e.dataHoraInicio,
          fim: fimDoEvento(e.dataHoraInicio, e.dataHoraFim),
        }),
      );
    if (ocupado) {
      throw Erros.conflito(
        'RN14_CONFLITO_PET',
        'O pet já tem um compromisso neste horário.',
      );
    }
  }

  private async garantirResponsavel(
    usuario: UsuarioAutenticado,
    petId: string,
  ) {
    const nivel = await this.politicaPet.nivel(usuario, petId);
    if (nivel !== 'RESPONSAVEL_PRINCIPAL' && nivel !== 'RESPONSAVEL')
      throw Erros.naoEncontrado('Pet não encontrado');
  }

  private resposta(e: {
    id: string;
    titulo: string;
    descricao: string | null;
    tipo: TipoEvento;
    dataHoraInicio: Date;
    dataHoraFim: Date | null;
    local: string | null;
    origem: Evento['origem'];
  }): Evento {
    return {
      id: e.id,
      titulo: e.titulo,
      descricao: e.descricao ?? undefined,
      tipo: e.tipo,
      dataHoraInicio: e.dataHoraInicio.toISOString(),
      dataHoraFim: e.dataHoraFim?.toISOString(),
      local: e.local ?? undefined,
      origem: e.origem,
    };
  }
}
