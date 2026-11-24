import { Injectable } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { PublicadorWebhook } from '../../../compartilhado/webhooks/publicador-webhook';
import { FilaEmailService } from '../../notificacao/aplicacao/fila-email.service';
import {
  autorDaMudanca,
  motivoParaNaoCancelar,
} from '../dominio/acompanhamento';
import type { StatusSolicitacao } from '../dominio/acompanhamento';

export interface MudancaStatus {
  dataHora: string;
  statusAnterior?: StatusSolicitacao;
  statusNovo: StatusSolicitacao;
  autor: string;
  descricao?: string;
}

export interface DetalheSolicitacao {
  id: string;
  status: StatusSolicitacao;
  dataHoraDesejada: string;
  observacoes?: string;
  motivoRecusa?: string;
  servico: { id: string; nome: string; preco: number; duracaoMinutos: number };
  empresa: { id: string; nome: string };
  pet: { id: string; nome: string };
  agendamento?: {
    id: string;
    dataHoraInicio: string;
    precoContratado: number;
    status: string;
    pagamento?: string;
  };
  podeCancelar: boolean;
  motivoSemCancelamento?: string;
  historico: MudancaStatus[];
}

const incluir = {
  servico: {
    include: { empresa: { select: { id: true, nomeFantasia: true } } },
  },
  pet: { select: { id: true, nome: true } },
  agendamento: {
    include: {
      pagamento: {
        select: { status: true, criadoEm: true },
        orderBy: { criadoEm: 'desc' as const },
        take: 1,
      },
    },
  },
  historicoSolicitacao: { orderBy: { dataHora: 'asc' as const } },
} as const;

const fmt = (d: Date) =>
  d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  });

/** O tutor consulta, acompanha e cancela as próprias solicitações (UC-42, RN38). */
@Injectable()
export class AcompanhamentoSolicitacoesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fila: FilaEmailService,
    private readonly webhooks: PublicadorWebhook,
  ) {}

  /** Solicitações do tutor, das próximas para as mais antigas, já com nomes e situação. */
  async listar(usuario: UsuarioAutenticado): Promise<DetalheSolicitacao[]> {
    this.garantirTutor(usuario);
    const lista = await this.prisma.solicitacaoServico.findMany({
      where: { tutorId: usuario.sub },
      include: incluir,
      orderBy: { dataHoraDesejada: 'desc' },
    });
    const agora = new Date();
    return lista.map((s) => this.detalhe(s, usuario.sub, agora));
  }

  /** CT-42-01: status atual e histórico de alterações. */
  async detalhar(
    usuario: UsuarioAutenticado,
    solicitacaoId: string,
  ): Promise<DetalheSolicitacao> {
    const s = await this.buscar(usuario, solicitacaoId);
    return this.detalhe(s, usuario.sub, new Date());
  }

  /** CT-42-02: cancela antes do horário; se já aceita, desfaz o agendamento e libera a agenda. */
  async cancelar(
    usuario: UsuarioAutenticado,
    solicitacaoId: string,
  ): Promise<void> {
    const s = await this.buscar(usuario, solicitacaoId);
    const agora = new Date();
    const motivo = motivoParaNaoCancelar(
      { status: s.status, horario: this.horario(s) },
      agora,
    );
    if (motivo) throw Erros.conflito('RN38_CANCELAMENTO_BLOQUEADO', motivo);
    const desfazer =
      s.agendamento && s.agendamento.status === 'AGENDADO'
        ? s.agendamento
        : null;
    await this.prisma.$transaction(async (tx) => {
      const mudou = await tx.solicitacaoServico.updateMany({
        where: { id: s.id, status: s.status },
        data: { status: 'CANCELADA' },
      });
      if (mudou.count === 0) {
        throw Erros.conflito(
          'RN38_CANCELAMENTO_BLOQUEADO',
          'A solicitação mudou enquanto você cancelava. Abra de novo para ver a situação.',
        );
      }
      if (desfazer) {
        await tx.agendamento.update({
          where: { id: desfazer.id },
          data: { status: 'CANCELADO' },
        });
      }
      await tx.historicoSolicitacao.create({
        data: {
          solicitacaoId: s.id,
          dataHora: agora,
          statusAnterior: s.status,
          statusNovo: 'CANCELADA',
          descricao: desfazer
            ? 'Cancelada pelo tutor; o agendamento foi desfeito.'
            : 'Cancelada pelo tutor.',
          autorId: usuario.sub,
        },
      });
    });

    await this.webhooks.publicar('solicitacao.status_alterado', {
      solicitacaoId: s.id,
      empresaId: s.servico.empresa.id,
      statusAnterior: s.status,
      statusNovo: 'CANCELADA',
    });
    if (desfazer) {
      await this.webhooks.publicar('agendamento.cancelado', {
        agendamentoId: desfazer.id,
        empresaId: s.servico.empresa.id,
        canceladoPor: 'TUTOR',
      });
    }
    const [empresa, tutor] = await Promise.all([
      this.prisma.usuario.findUnique({
        where: { id: s.servico.empresa.id },
        select: { email: true },
      }),
      this.prisma.tutor.findUnique({
        where: { id: usuario.sub },
        select: { nome: true },
      }),
    ]);
    if (empresa) {
      await this.fila.enviar('SOLICITACAO_CANCELADA', empresa.email, {
        empresa: s.servico.empresa.nomeFantasia,
        tutor: tutor?.nome ?? 'O tutor',
        pet: s.pet.nome,
        servico: s.servico.nome,
        dataHora: fmt(this.horario(s)),
        agendamentoDesfeito: !!desfazer,
      });
    }
  }

  private garantirTutor(usuario: UsuarioAutenticado) {
    if (usuario.tipo !== 'TUTOR') {
      throw Erros.semPermissao(
        'Só o tutor acompanha as próprias solicitações.',
      );
    }
  }

  private async buscar(usuario: UsuarioAutenticado, solicitacaoId: string) {
    this.garantirTutor(usuario);
    const s = await this.prisma.solicitacaoServico.findUnique({
      where: { id: solicitacaoId },
      include: incluir,
    });
    // De outro tutor, responde como se não existisse.
    if (!s || s.tutorId !== usuario.sub) {
      throw Erros.naoEncontrado('Solicitação não encontrada');
    }
    return s;
  }

  private horario(s: {
    dataHoraDesejada: Date;
    agendamento: { dataHoraInicio: Date } | null;
  }): Date {
    return s.agendamento?.dataHoraInicio ?? s.dataHoraDesejada;
  }

  private detalhe(
    s: Awaited<ReturnType<AcompanhamentoSolicitacoesService['buscar']>>,
    tutorId: string,
    agora: Date,
  ): DetalheSolicitacao {
    const motivo = motivoParaNaoCancelar(
      { status: s.status, horario: this.horario(s) },
      agora,
    );
    return {
      id: s.id,
      status: s.status,
      dataHoraDesejada: s.dataHoraDesejada.toISOString(),
      observacoes: s.observacoes ?? undefined,
      motivoRecusa: s.motivoRecusa ?? undefined,
      servico: {
        id: s.servico.id,
        nome: s.servico.nome,
        preco: s.servico.preco.toNumber(),
        duracaoMinutos: s.servico.duracaoMinutos,
      },
      empresa: {
        id: s.servico.empresa.id,
        nome: s.servico.empresa.nomeFantasia,
      },
      pet: { id: s.pet.id, nome: s.pet.nome },
      agendamento: s.agendamento
        ? {
            id: s.agendamento.id,
            dataHoraInicio: s.agendamento.dataHoraInicio.toISOString(),
            precoContratado: s.agendamento.precoContratado.toNumber(),
            status: s.agendamento.status,
            pagamento: s.agendamento.pagamento[0]?.status,
          }
        : undefined,
      podeCancelar: motivo === null,
      motivoSemCancelamento: motivo ?? undefined,
      historico: s.historicoSolicitacao.map((h) => ({
        dataHora: h.dataHora.toISOString(),
        statusAnterior: h.statusAnterior ?? undefined,
        statusNovo: h.statusNovo,
        autor: autorDaMudanca(
          h.autorId,
          tutorId,
          s.servico.empresa.nomeFantasia,
        ),
        descricao: h.descricao ?? undefined,
      })),
    };
  }
}
