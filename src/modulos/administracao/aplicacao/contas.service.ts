import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { ErroNegocio, Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import {
  ACAO_DO_STATUS,
  motivoRecusa,
  tipoDaConta,
} from '../dominio/conta-usuario';
import type {
  NovoStatus,
  StatusConta,
  TipoConta,
} from '../dominio/conta-usuario';

export interface ContaResumo {
  id: string;
  email: string;
  nome: string;
  tipo: TipoConta;
  status: StatusConta;
  dataCadastro: string;
}

export interface ContaDetalhe extends ContaResumo {
  emailConfirmado: boolean;
  sessoesAtivas: number;
  historico: {
    dataHora: string;
    acao: string;
    autorId?: string;
    motivo?: string;
  }[];
}

const INCLUIR = {
  tutor: { select: { nome: true } },
  empresaEnterprise: { select: { nomeFantasia: true } },
  funcionarioEnterprise: { select: { nome: true } },
  administrador: { select: { nome: true } },
} as const;

type ContaComPessoa = {
  id: string;
  email: string;
  status: StatusConta;
  dataCadastro: Date;
  tutor: { nome: string } | null;
  empresaEnterprise: { nomeFantasia: string } | null;
  funcionarioEnterprise: { nome: string } | null;
  administrador: { nome: string } | null;
};

/** Gestão de contas de usuários pela administração (UC-28, RN34). */
@Injectable()
export class ContasService {
  private readonly log = new Logger(ContasService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listar(filtro: {
    busca?: string;
    status?: StatusConta;
  }): Promise<ContaResumo[]> {
    const busca = filtro.busca?.trim();
    const contem = busca
      ? { contains: busca, mode: 'insensitive' as const }
      : undefined;
    const contas = await this.prisma.usuario.findMany({
      where: {
        ...(filtro.status ? { status: filtro.status } : {}),
        ...(contem
          ? {
              OR: [
                { email: contem },
                { tutor: { nome: contem } },
                { empresaEnterprise: { nomeFantasia: contem } },
                { funcionarioEnterprise: { nome: contem } },
                { administrador: { nome: contem } },
              ],
            }
          : {}),
      },
      include: INCLUIR,
      orderBy: { dataCadastro: 'desc' },
      take: 100,
    });
    return contas.map((c) => this.resumo(c));
  }

  /** Passo 2: perfil, status atual e o histórico de mudanças da conta. */
  async detalhar(usuarioId: string): Promise<ContaDetalhe> {
    const conta = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      include: { ...INCLUIR, _count: { select: { sessao: true } } },
    });
    if (!conta) throw Erros.naoEncontrado('Conta não encontrada');
    const eventos = await this.prisma.logAuditoria.findMany({
      where: {
        entidade: 'Usuario',
        entidadeId: usuarioId,
        acao: { in: Object.values(ACAO_DO_STATUS) },
      },
      orderBy: { dataHora: 'desc' },
      take: 20,
    });
    return {
      ...this.resumo(conta),
      emailConfirmado: conta.emailConfirmado,
      sessoesAtivas: conta._count.sessao,
      historico: eventos.map((e) => ({
        dataHora: e.dataHora.toISOString(),
        acao: e.acao,
        autorId: e.autorId ?? undefined,
        motivo: e.detalhes ?? undefined,
      })),
    };
  }

  /**
   * CT-28-01 e CT-28-02: muda o status e grava a auditoria na mesma transação; se a auditoria
   * falhar, nada muda (RN34). Bloquear ou suspender encerra as sessões da conta.
   */
  async alterarStatus(
    admin: UsuarioAutenticado,
    usuarioId: string,
    dados: { status: NovoStatus; motivo: string },
    ip?: string,
  ): Promise<void> {
    const conta = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
    });
    if (!conta) throw Erros.naoEncontrado('Conta não encontrada');
    const recusa = motivoRecusa({
      atual: conta.status,
      novo: dados.status,
      propriaConta: admin.sub === usuarioId,
    });
    if (recusa) throw Erros.conflito('RN34_STATUS_INVALIDO', recusa);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.usuario.update({
          where: { id: usuarioId },
          data: {
            status: dados.status,
            ...(dados.status === 'ATIVA'
              ? { tentativasLoginFalhas: 0, bloqueadoAte: null }
              : {}),
          },
        });
        if (dados.status !== 'ATIVA') {
          await tx.sessao.deleteMany({ where: { usuarioId } });
        }
        await tx.logAuditoria.create({
          data: {
            dataHora: new Date(),
            acao: ACAO_DO_STATUS[dados.status],
            entidade: 'Usuario',
            entidadeId: usuarioId,
            nivel: dados.status === 'ATIVA' ? 'INFO' : 'ALERTA',
            autorId: admin.sub,
            ipOrigem: ip?.slice(0, 255),
            detalhes: dados.motivo.trim(),
          },
        });
      });
    } catch (erro) {
      this.log.error(
        `Mudança de status da conta ${usuarioId} cancelada: ${String(erro)}`,
      );
      throw new ErroNegocio(
        HttpStatus.SERVICE_UNAVAILABLE,
        'RN34_AUDITORIA_INDISPONIVEL',
        'Não foi possível concluir a alteração',
        'A auditoria não respondeu e o status da conta não mudou. Tente de novo.',
      );
    }
  }

  private resumo(c: ContaComPessoa): ContaResumo {
    return {
      id: c.id,
      email: c.email,
      nome:
        c.tutor?.nome ??
        c.empresaEnterprise?.nomeFantasia ??
        c.funcionarioEnterprise?.nome ??
        c.administrador?.nome ??
        c.email,
      tipo: tipoDaConta(c),
      status: c.status,
      dataCadastro: c.dataCadastro.toISOString(),
    };
  }
}
