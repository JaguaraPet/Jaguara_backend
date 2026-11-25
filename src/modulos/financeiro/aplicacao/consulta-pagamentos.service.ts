import { Injectable } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { FilaEmailService } from '../../notificacao/aplicacao/fila-email.service';
import {
  intervaloDoFiltro,
  motivoSemReembolso,
} from '../dominio/consulta-pagamentos';

export interface PagamentoDetalhado {
  id: string;
  codigoTransacao: string;
  valor: number;
  dataHora: string;
  metodo: string;
  status: string;
  dataConfirmacao?: string;
  agendamentoId?: string;
  descricao: string;
  /** Empresa (para o tutor) ou tutor (para a empresa). */
  contraparte: string;
  pet?: string;
  reembolso?: { status: string; motivo: string; dataSolicitacao: string };
  podeReembolsar: boolean;
}

export interface FiltroPagamentos {
  status?: string;
  de?: string;
  ate?: string;
}

const incluir = {
  agendamento: {
    select: {
      dataHoraInicio: true,
      servico: { select: { nome: true } },
      pet: { select: { nome: true } },
    },
  },
  recebedor: { select: { nomeFantasia: true } },
  pagador: { select: { nome: true } },
  solicitacaoReembolso: { orderBy: { dataSolicitacao: 'desc' as const } },
} as const;

/** Pagamentos realizados (tutor) e recebidos (empresa), com o pedido de reembolso (UC-45, RN39). */
@Injectable()
export class ConsultaPagamentosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fila: FilaEmailService,
  ) {}

  /** CT-45-01: lista do mais recente para o mais antigo, com filtro de status e período. */
  async listar(
    usuario: UsuarioAutenticado,
    filtro: FiltroPagamentos,
  ): Promise<PagamentoDetalhado[]> {
    const dono = this.dono(usuario);
    const pagamentos = await this.prisma.pagamento.findMany({
      where: {
        ...dono,
        ...(filtro.status ? { status: filtro.status as never } : {}),
        ...(intervaloDoFiltro(filtro.de, filtro.ate)
          ? { dataHora: intervaloDoFiltro(filtro.de, filtro.ate) }
          : {}),
      },
      include: incluir,
      orderBy: { dataHora: 'desc' },
      take: 200,
    });
    const agora = new Date();
    return pagamentos.map((p) => this.detalhe(p, usuario, agora));
  }

  async detalhar(
    usuario: UsuarioAutenticado,
    pagamentoId: string,
  ): Promise<PagamentoDetalhado> {
    const p = await this.buscar(usuario, pagamentoId);
    return this.detalhe(p, usuario, new Date());
  }

  /** CT-45-02: só pagamento confirmado, sem outro pedido e no prazo; a empresa é avisada. */
  async solicitarReembolso(
    usuario: UsuarioAutenticado,
    pagamentoId: string,
    motivo: string,
  ): Promise<PagamentoDetalhado> {
    if (usuario.tipo !== 'TUTOR') {
      throw Erros.semPermissao('Só quem pagou pede o reembolso.');
    }
    const texto = motivo.trim();
    if (texto.length < 10) {
      throw Erros.dadosInvalidos(
        'motivo',
        'Conte o motivo em pelo menos 10 caracteres.',
      );
    }
    const p = await this.buscar(usuario, pagamentoId);
    const agora = new Date();
    const recusa = motivoSemReembolso(
      {
        status: p.status,
        dataConfirmacao: p.dataConfirmacao,
        reembolsos: p.solicitacaoReembolso,
      },
      agora,
    );
    if (recusa) throw Erros.conflito('RN39_REEMBOLSO_INDISPONIVEL', recusa);
    await this.prisma.solicitacaoReembolso.create({
      data: {
        pagamentoId: p.id,
        motivo: texto,
        valor: p.valor,
        dataSolicitacao: agora,
        status: 'EM_ANALISE',
      },
    });
    if (p.recebedorId) {
      const empresa = await this.prisma.usuario.findUnique({
        where: { id: p.recebedorId },
        select: { email: true },
      });
      if (empresa) {
        await this.fila.enviar('NOTIFICACAO', empresa.email, {
          titulo: 'Pedido de reembolso',
          mensagem: `${p.pagador.nome} pediu o reembolso de R$ ${p.valor.toFixed(2).replace('.', ',')} (${this.descricao(p)}). Motivo: ${texto}`,
        });
      }
    }
    return this.detalhar(usuario, pagamentoId);
  }

  /** Tutor vê os que pagou; empresa vê os que recebeu (RN22). */
  private dono(usuario: UsuarioAutenticado) {
    if (usuario.tipo === 'TUTOR') return { pagadorId: usuario.sub };
    if (usuario.empresaId && usuario.permissoes.includes('financeiro:ler')) {
      return { recebedorId: usuario.empresaId };
    }
    throw Erros.semPermissao();
  }

  private async buscar(usuario: UsuarioAutenticado, pagamentoId: string) {
    const dono = this.dono(usuario);
    const p = await this.prisma.pagamento.findFirst({
      where: { id: pagamentoId, ...dono },
      include: incluir,
    });
    if (!p) throw Erros.naoEncontrado('Pagamento não encontrado');
    return p;
  }

  private descricao(p: {
    assinaturaId: string | null;
    agendamento: { servico: { nome: string } } | null;
  }): string {
    if (p.assinaturaId) return 'Assinatura PANTERA';
    return p.agendamento?.servico.nome ?? 'Pagamento';
  }

  private detalhe(
    p: Awaited<ReturnType<ConsultaPagamentosService['buscar']>>,
    usuario: UsuarioAutenticado,
    agora: Date,
  ): PagamentoDetalhado {
    const ultimo = p.solicitacaoReembolso[0];
    return {
      id: p.id,
      codigoTransacao: p.codigoTransacao,
      valor: p.valor.toNumber(),
      dataHora: p.dataHora.toISOString(),
      metodo: p.metodo,
      status: p.status,
      dataConfirmacao: p.dataConfirmacao?.toISOString(),
      agendamentoId: p.agendamentoId ?? undefined,
      descricao: this.descricao(p),
      contraparte:
        usuario.tipo === 'TUTOR'
          ? (p.recebedor?.nomeFantasia ?? 'Jaguara')
          : p.pagador.nome,
      pet: p.agendamento?.pet.nome,
      reembolso: ultimo
        ? {
            status: ultimo.status,
            motivo: ultimo.motivo,
            dataSolicitacao: ultimo.dataSolicitacao.toISOString(),
          }
        : undefined,
      podeReembolsar:
        usuario.tipo === 'TUTOR' &&
        motivoSemReembolso(
          {
            status: p.status,
            dataConfirmacao: p.dataConfirmacao,
            reembolsos: p.solicitacaoReembolso,
          },
          agora,
        ) === null,
    };
  }
}
