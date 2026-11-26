import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { ErroNegocio, Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { FilaEmailService } from '../../notificacao/aplicacao/fila-email.service';
import {
  aceitaComplemento,
  aceitaIntervencao,
  comComplemento,
  encerra,
  gerarProtocolo,
  rotuloStatus,
} from '../dominio/chamado';
import type { StatusChamado, StatusIntervencao } from '../dominio/chamado';
import { tipoDaConta } from '../dominio/conta-usuario';
import type { TipoConta } from '../dominio/conta-usuario';

export interface Chamado {
  id: string;
  protocolo: string;
  titulo: string;
  descricao: string;
  status: StatusChamado;
  dataAbertura: string;
  dataFechamento?: string;
}

export interface ChamadoResumo extends Chamado {
  solicitante: { id: string; nome: string; email: string; tipo: TipoConta };
  atendente?: string;
}

export interface Intervencao {
  dataHora: string;
  acaoExecutada: string;
  descricao: string;
  autor: string;
}

export interface ChamadoDetalhe extends ChamadoResumo {
  intervencoes: Intervencao[];
}

const PESSOA = {
  select: {
    id: true,
    email: true,
    tutor: { select: { nome: true } },
    empresaEnterprise: { select: { nomeFantasia: true } },
    funcionarioEnterprise: { select: { nome: true } },
    administrador: { select: { nome: true } },
  },
} as const;

type Pessoa = {
  id: string;
  email: string;
  tutor: { nome: string } | null;
  empresaEnterprise: { nomeFantasia: string } | null;
  funcionarioEnterprise: { nome: string } | null;
  administrador: { nome: string } | null;
};

type Registro = {
  id: string;
  protocolo: string;
  titulo: string;
  descricao: string;
  status: StatusChamado;
  dataAbertura: Date;
  dataFechamento: Date | null;
};

const nomeDe = (p: Pessoa) =>
  p.tutor?.nome ??
  p.empresaEnterprise?.nomeFantasia ??
  p.funcionarioEnterprise?.nome ??
  p.administrador?.nome ??
  p.email;

/** Chamados de suporte (UC-26): o usuário abre, o administrador intervém e tudo fica auditado (RN32). */
@Injectable()
export class ChamadosService {
  private readonly log = new Logger(ChamadosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fila: FilaEmailService,
  ) {}

  async abrir(
    usuario: UsuarioAutenticado,
    dados: { titulo: string; descricao: string },
  ): Promise<Chamado> {
    const agora = new Date();
    const criado = await this.prisma.chamadoSuporte.create({
      data: {
        protocolo: gerarProtocolo(agora),
        titulo: dados.titulo.trim(),
        descricao: dados.descricao.trim(),
        status: 'ABERTO',
        dataAbertura: agora,
        solicitanteId: usuario.sub,
      },
    });
    return this.chamado(criado);
  }

  async meus(usuario: UsuarioAutenticado): Promise<Chamado[]> {
    const lista = await this.prisma.chamadoSuporte.findMany({
      where: { solicitanteId: usuario.sub },
      orderBy: { dataAbertura: 'desc' },
    });
    return lista.map((c) => this.chamado(c));
  }

  /** FA1 do UC-26: o solicitante responde ao pedido de informação e o chamado volta para análise. */
  async complementar(
    usuario: UsuarioAutenticado,
    chamadoId: string,
    mensagem: string,
  ): Promise<Chamado> {
    const atual = await this.prisma.chamadoSuporte.findUnique({
      where: { id: chamadoId },
    });
    if (!atual || atual.solicitanteId !== usuario.sub) {
      throw Erros.naoEncontrado('Chamado não encontrado');
    }
    if (!aceitaComplemento(atual.status)) {
      throw Erros.conflito(
        'CHAMADO_SEM_PEDIDO',
        'O suporte não pediu informação neste chamado.',
      );
    }
    const agora = new Date();
    const alterado = await this.prisma.chamadoSuporte.update({
      where: { id: chamadoId },
      data: {
        descricao: comComplemento(atual.descricao, mensagem, agora),
        status: 'EM_ANALISE',
      },
    });
    return this.chamado(alterado);
  }

  async listar(status?: StatusChamado): Promise<ChamadoResumo[]> {
    const lista = await this.prisma.chamadoSuporte.findMany({
      where: status ? { status } : {},
      orderBy: { dataAbertura: 'asc' },
      include: {
        solicitante: PESSOA,
        atendente: { select: { nome: true } },
      },
    });
    return lista.map((c) => this.resumo(c));
  }

  async detalhar(chamadoId: string): Promise<ChamadoDetalhe> {
    const c = await this.prisma.chamadoSuporte.findUnique({
      where: { id: chamadoId },
      include: {
        solicitante: PESSOA,
        atendente: { select: { nome: true } },
        intervencaoSuporte: {
          orderBy: { dataHora: 'asc' },
          include: { executadaPor: { select: { nome: true } } },
        },
      },
    });
    if (!c) throw Erros.naoEncontrado('Chamado não encontrado');
    return {
      ...this.resumo(c),
      intervencoes: c.intervencaoSuporte.map((i) => ({
        dataHora: i.dataHora.toISOString(),
        acaoExecutada: i.acaoExecutada,
        descricao: i.descricao,
        autor: i.executadaPor.nome,
      })),
    };
  }

  /** CT-26-01: a intervenção entra no chamado e na auditoria na mesma transação (RN32). */
  async intervir(
    admin: UsuarioAutenticado,
    chamadoId: string,
    dados: {
      acaoExecutada: string;
      descricao: string;
      status: StatusIntervencao;
    },
    ip?: string,
  ): Promise<ChamadoDetalhe> {
    await this.registrar(admin, chamadoId, {
      acaoExecutada: dados.acaoExecutada.trim(),
      descricao: dados.descricao.trim(),
      status: dados.status,
      ip,
    });
    return this.detalhar(chamadoId);
  }

  /** CT-26-02: falta informação; o chamado espera o solicitante, que recebe o pedido por e-mail. */
  async pedirInformacao(
    admin: UsuarioAutenticado,
    chamadoId: string,
    mensagem: string,
    ip?: string,
  ): Promise<ChamadoDetalhe> {
    await this.registrar(admin, chamadoId, {
      acaoExecutada: 'Pedido de informação',
      descricao: mensagem.trim(),
      status: 'AGUARDANDO_INFORMACAO',
      ip,
    });
    return this.detalhar(chamadoId);
  }

  private async registrar(
    admin: UsuarioAutenticado,
    chamadoId: string,
    dados: {
      acaoExecutada: string;
      descricao: string;
      status: StatusChamado;
      ip?: string;
    },
  ): Promise<void> {
    const atual = await this.prisma.chamadoSuporte.findUnique({
      where: { id: chamadoId },
      include: { solicitante: { select: { email: true } } },
    });
    if (!atual) throw Erros.naoEncontrado('Chamado não encontrado');
    if (!aceitaIntervencao(atual.status)) {
      throw Erros.conflito(
        'CHAMADO_FECHADO',
        'Este chamado já foi fechado. Peça ao usuário para abrir outro.',
      );
    }
    const agora = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.intervencaoSuporte.create({
          data: {
            chamadoId,
            dataHora: agora,
            acaoExecutada: dados.acaoExecutada.slice(0, 255),
            descricao: dados.descricao,
            executadaPorId: admin.sub,
          },
        });
        await tx.chamadoSuporte.update({
          where: { id: chamadoId },
          data: {
            status: dados.status,
            atendenteId: admin.sub,
            dataFechamento: encerra(dados.status) ? agora : null,
          },
        });
        await tx.logAuditoria.create({
          data: {
            dataHora: agora,
            acao: 'INTERVENCAO_SUPORTE',
            entidade: 'ChamadoSuporte',
            entidadeId: chamadoId,
            nivel: 'INFO',
            autorId: admin.sub,
            ipOrigem: dados.ip?.slice(0, 255),
            detalhes: `${dados.acaoExecutada}: ${dados.descricao}`.slice(
              0,
              2000,
            ),
          },
        });
      });
    } catch (erro) {
      this.log.error(
        `Intervenção no chamado ${chamadoId} cancelada: ${String(erro)}`,
      );
      throw new ErroNegocio(
        HttpStatus.SERVICE_UNAVAILABLE,
        'RN32_AUDITORIA_INDISPONIVEL',
        'Não foi possível registrar a intervenção',
        'A auditoria não respondeu e o chamado não mudou. Tente de novo.',
      );
    }
    if (
      dados.status !== atual.status ||
      dados.status === 'AGUARDANDO_INFORMACAO'
    ) {
      await this.fila
        .enviar('NOTIFICACAO', atual.solicitante.email, {
          titulo: `Chamado ${atual.protocolo}: ${rotuloStatus(dados.status)}`,
          mensagem:
            dados.status === 'AGUARDANDO_INFORMACAO'
              ? `O suporte precisa de mais informações: ${dados.descricao} Responda pelo Jaguara, em Suporte.`
              : `${dados.acaoExecutada}. ${dados.descricao}`,
        })
        .catch((e: unknown) =>
          this.log.warn(
            `Aviso do chamado ${chamadoId} não enviado: ${String(e)}`,
          ),
        );
    }
  }

  private chamado(c: Registro): Chamado {
    return {
      id: c.id,
      protocolo: c.protocolo,
      titulo: c.titulo,
      descricao: c.descricao,
      status: c.status,
      dataAbertura: c.dataAbertura.toISOString(),
      dataFechamento: c.dataFechamento?.toISOString(),
    };
  }

  private resumo(
    c: Registro & { solicitante: Pessoa; atendente: { nome: string } | null },
  ): ChamadoResumo {
    return {
      ...this.chamado(c),
      solicitante: {
        id: c.solicitante.id,
        nome: nomeDe(c.solicitante),
        email: c.solicitante.email,
        tipo: tipoDaConta(c.solicitante),
      },
      atendente: c.atendente?.nome,
    };
  }
}
