import { Injectable } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { PublicadorWebhook } from '../../../compartilhado/webhooks/publicador-webhook';
import { PoliticaAcessoPet } from '../../pet/aplicacao/politica-acesso-pet';
import {
  diaDaSemana,
  horariosDisponiveis,
  inicioDoDiaBrasilia,
  Janela,
  Ocupacao,
} from '../dominio/disponibilidade';
import { DIAS } from '../dominio/horarios';

export type StatusSolicitacao =
  'PENDENTE' | 'ACEITA' | 'RECUSADA' | 'CANCELADA' | 'CONCLUIDA' | 'ENCERRADA';

export interface Solicitacao {
  id: string;
  servicoId: string;
  petId: string;
  tutorId: string;
  dataHoraDesejada: string;
  status: StatusSolicitacao;
  motivoRecusa?: string;
}

const minutosDoDia = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();

/** Horários disponíveis (RN40) e solicitação de agendamento pelo tutor (UC-40, RN38). */
@Injectable()
export class SolicitacoesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly politicaPet: PoliticaAcessoPet,
    private readonly webhooks: PublicadorWebhook,
  ) {}

  async horariosDisponiveis(
    servicoId: string,
    data: string,
  ): Promise<string[]> {
    const servico = await this.prisma.servico.findUnique({
      where: { id: servicoId },
    });
    if (!servico || !servico.ativo)
      throw Erros.naoEncontrado('Serviço não encontrado');
    const livres = await this.calcular(
      servico.empresaId,
      servico.duracaoMinutos,
      data,
    );
    return livres.map((d) => d.toISOString());
  }

  /** CT-40-01: cria a solicitação pendente com a primeira entrada do histórico. */
  async solicitar(
    usuario: UsuarioAutenticado,
    dados: {
      servicoId: string;
      petId: string;
      dataHoraDesejada: string;
      observacoes?: string;
    },
  ): Promise<Solicitacao> {
    const servico = await this.prisma.servico.findUnique({
      where: { id: dados.servicoId },
    });
    if (!servico || !servico.ativo)
      throw Erros.naoEncontrado('Serviço não encontrado');
    const nivel = await this.politicaPet.nivel(usuario, dados.petId);
    if (nivel !== 'RESPONSAVEL_PRINCIPAL' && nivel !== 'RESPONSAVEL') {
      throw Erros.semPermissao('Escolha um dos seus pets.');
    }

    const inicio = new Date(dados.dataHoraDesejada);
    const fim = new Date(inicio.getTime() + servico.duracaoMinutos * 60_000);
    // CT-40-02: confere de novo, porque o horário pode ter sido ocupado enquanto o tutor escolhia.
    const data = new Date(inicio.getTime() - 3 * 3_600_000)
      .toISOString()
      .slice(0, 10);
    const livres = await this.calcular(
      servico.empresaId,
      servico.duracaoMinutos,
      data,
    );
    if (!livres.some((d) => d.getTime() === inicio.getTime())) {
      throw Erros.conflito(
        'RN14_HORARIO_INDISPONIVEL',
        'Este horário não está mais disponível. Escolha outro.',
      );
    }
    const conflitoPet = await this.prisma.agendamento.count({
      where: {
        petId: dados.petId,
        status: 'AGENDADO',
        dataHoraInicio: { lt: fim },
        dataHoraFim: { gt: inicio },
      },
    });
    if (conflitoPet > 0) {
      throw Erros.conflito(
        'RN14_CONFLITO_PET',
        'Seu pet já tem um agendamento neste horário.',
      );
    }

    const agora = new Date();
    const criada = await this.prisma.solicitacaoServico.create({
      data: {
        servicoId: servico.id,
        petId: dados.petId,
        tutorId: usuario.sub,
        dataSolicitacao: agora,
        dataHoraDesejada: inicio,
        status: 'PENDENTE',
        observacoes: dados.observacoes?.trim() || null,
        historicoSolicitacao: {
          create: {
            dataHora: agora,
            statusNovo: 'PENDENTE',
            descricao: 'Solicitação enviada pelo tutor',
            autorId: usuario.sub,
          },
        },
      },
    });
    await this.webhooks.publicar('solicitacao.criada', {
      solicitacaoId: criada.id,
      servicoId: servico.id,
      empresaId: servico.empresaId,
      dataHoraDesejada: inicio.toISOString(),
      status: 'PENDENTE',
    });
    return this.resposta(criada);
  }

  /** UC-42 (tutor) e UC-41 (empresa): solicitações do usuário logado. */
  async listar(
    usuario: UsuarioAutenticado,
    status?: StatusSolicitacao,
  ): Promise<Solicitacao[]> {
    const where =
      usuario.tipo === 'TUTOR'
        ? { tutorId: usuario.sub }
        : usuario.empresaId
          ? { servico: { empresaId: usuario.empresaId } }
          : null;
    if (!where) throw Erros.semPermissao();
    const solicitacoes = await this.prisma.solicitacaoServico.findMany({
      where: { ...where, ...(status ? { status } : {}) },
      orderBy: { dataHoraDesejada: 'asc' },
    });
    return solicitacoes.map((s) => this.resposta(s));
  }

  /** Janelas de atuação do dia e agendamentos ativos de cada profissional ou recurso. */
  private async calcular(
    empresaId: string,
    duracaoMinutos: number,
    data: string,
  ) {
    const dia = DIAS[diaDaSemana(data)];
    const horarios = await this.prisma.horarioAtuacao.findMany({
      where: {
        diaSemana: dia,
        OR: [
          { funcionario: { empresaId, ativo: true } },
          { recurso: { empresaId, ativo: true } },
        ],
      },
    });
    const janelas: Janela[] = horarios.map((h) => ({
      donoId: (h.funcionarioId ?? h.recursoId)!,
      inicioMin: minutosDoDia(h.horaInicio),
      fimMin: minutosDoDia(h.horaFim),
    }));
    const inicioDia = inicioDoDiaBrasilia(data);
    const fimDia = new Date(inicioDia.getTime() + 86_400_000);
    const agendamentos = await this.prisma.agendamento.findMany({
      where: {
        status: 'AGENDADO',
        dataHoraInicio: { lt: fimDia },
        dataHoraFim: { gt: inicioDia },
        OR: [{ profissional: { empresaId } }, { recurso: { empresaId } }],
      },
      select: {
        profissionalId: true,
        recursoId: true,
        dataHoraInicio: true,
        dataHoraFim: true,
      },
    });
    const ocupacoes: Ocupacao[] = agendamentos.flatMap((a) =>
      [a.profissionalId, a.recursoId]
        .filter((id): id is string => !!id)
        .map((donoId) => ({
          donoId,
          inicio: a.dataHoraInicio,
          fim: a.dataHoraFim,
        })),
    );
    return horariosDisponiveis({
      data,
      duracaoMinutos,
      janelas,
      ocupacoes,
      agora: new Date(),
    });
  }

  private resposta(s: {
    id: string;
    servicoId: string;
    petId: string;
    tutorId: string;
    dataHoraDesejada: Date;
    status: StatusSolicitacao;
    motivoRecusa: string | null;
  }): Solicitacao {
    return {
      id: s.id,
      servicoId: s.servicoId,
      petId: s.petId,
      tutorId: s.tutorId,
      dataHoraDesejada: s.dataHoraDesejada.toISOString(),
      status: s.status,
      motivoRecusa: s.motivoRecusa ?? undefined,
    };
  }
}
