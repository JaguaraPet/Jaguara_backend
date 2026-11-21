import { Injectable } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { hojeBrasilia } from '../../notificacao/dominio/lembretes';
import { PoliticaAcessoPet } from '../../pet/aplicacao/politica-acesso-pet';
import {
  diaDeBrasilia,
  resumoDoDia,
  validarPlano,
} from '../dominio/alimentacao';
import type { ResumoDoDia } from '../dominio/alimentacao';

export interface PlanoAlimentar {
  id: string;
  alimento: string;
  metaDiariaGramas: number;
  limiteDiarioGramas?: number;
  refeicoesPorDia: number;
  dataInicio: string;
}

export interface Refeicao {
  id: string;
  dataHora: string;
  alimento: string;
  quantidadeGramas: number;
  observacao?: string;
}

/** Plano alimentar e registro de refeições (UC-08, RN12). */
@Injectable()
export class AlimentacaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly politicaPet: PoliticaAcessoPet,
  ) {}

  async plano(
    usuario: UsuarioAutenticado,
    petId: string,
  ): Promise<PlanoAlimentar | null> {
    await this.garantirResponsavel(usuario, petId);
    const plano = await this.planoAtivo(petId);
    return plano ? this.respostaPlano(plano) : null;
  }

  /** RN12: o tutor define meta e limite diários; o plano anterior fica no histórico. */
  async definirPlano(
    usuario: UsuarioAutenticado,
    petId: string,
    dados: {
      alimento: string;
      metaDiariaGramas: number;
      limiteDiarioGramas?: number;
      refeicoesPorDia: number;
    },
  ): Promise<PlanoAlimentar> {
    await this.garantirResponsavel(usuario, petId);
    const erro = validarPlano(dados);
    if (erro) throw Erros.dadosInvalidos(erro.campo, erro.mensagem);
    const [, criado] = await this.prisma.$transaction([
      this.prisma.planoAlimentar.updateMany({
        where: { petId, ativo: true },
        data: { ativo: false },
      }),
      this.prisma.planoAlimentar.create({
        data: {
          petId,
          alimento: dados.alimento.trim(),
          metaDiariaGramas: dados.metaDiariaGramas,
          limiteDiarioGramas: dados.limiteDiarioGramas ?? null,
          refeicoesPorDia: dados.refeicoesPorDia,
          dataInicio: new Date(hojeBrasilia()),
          ativo: true,
        },
      }),
    ]);
    return this.respostaPlano(criado);
  }

  /** Refeições de um dia (padrão: hoje) com o consumo e o alerta de limite. */
  async refeicoesDoDia(
    usuario: UsuarioAutenticado,
    petId: string,
    data?: string,
  ): Promise<{ data: string; refeicoes: Refeicao[] } & ResumoDoDia> {
    await this.garantirResponsavel(usuario, petId);
    const dia = diaDeBrasilia(
      data ? new Date(`${data}T12:00:00-03:00`) : new Date(),
    );
    const [refeicoes, plano] = await Promise.all([
      this.prisma.registroAlimentacao.findMany({
        where: { petId, dataHora: { gte: dia.inicio, lt: dia.fim } },
        orderBy: { dataHora: 'asc' },
      }),
      this.planoAtivo(petId),
    ]);
    return {
      data: dia.data,
      refeicoes: refeicoes.map((r) => this.respostaRefeicao(r)),
      ...resumoDoDia(
        refeicoes.map((r) => r.quantidadeGramas.toNumber()),
        plano && this.limites(plano),
      ),
    };
  }

  /**
   * CT-08-01 e CT-08-02: a refeição sempre é registrada; passando do limite do dia, a
   * resposta traz o alerta (RN12).
   */
  async registrarRefeicao(
    usuario: UsuarioAutenticado,
    petId: string,
    dados: {
      dataHora: string;
      alimento: string;
      quantidadeGramas: number;
      observacao?: string;
    },
  ): Promise<Refeicao & ResumoDoDia> {
    await this.garantirResponsavel(usuario, petId);
    const quando = new Date(dados.dataHora);
    if (quando.getTime() > Date.now() + 5 * 60_000) {
      throw Erros.dadosInvalidos(
        'dataHora',
        'Registre refeições que já aconteceram.',
      );
    }
    const plano = await this.planoAtivo(petId);
    const criada = await this.prisma.registroAlimentacao.create({
      data: {
        petId,
        planoId: plano?.id,
        dataHora: quando,
        alimento: dados.alimento.trim(),
        quantidadeGramas: dados.quantidadeGramas,
        observacao: dados.observacao?.trim() || null,
      },
    });
    const dia = diaDeBrasilia(quando);
    const doDia = await this.prisma.registroAlimentacao.findMany({
      where: { petId, dataHora: { gte: dia.inicio, lt: dia.fim } },
      select: { quantidadeGramas: true },
    });
    return {
      ...this.respostaRefeicao(criada),
      ...resumoDoDia(
        doDia.map((r) => r.quantidadeGramas.toNumber()),
        plano && this.limites(plano),
      ),
    };
  }

  private planoAtivo(petId: string) {
    return this.prisma.planoAlimentar.findFirst({
      where: { petId, ativo: true },
      orderBy: { criadoEm: 'desc' },
    });
  }

  private limites(p: {
    metaDiariaGramas: { toNumber(): number };
    limiteDiarioGramas: { toNumber(): number } | null;
  }) {
    return {
      metaDiariaGramas: p.metaDiariaGramas.toNumber(),
      limiteDiarioGramas: p.limiteDiarioGramas?.toNumber() ?? null,
    };
  }

  private async garantirResponsavel(
    usuario: UsuarioAutenticado,
    petId: string,
  ) {
    const nivel = await this.politicaPet.nivel(usuario, petId);
    if (nivel !== 'RESPONSAVEL_PRINCIPAL' && nivel !== 'RESPONSAVEL')
      throw Erros.naoEncontrado('Pet não encontrado');
  }

  private respostaPlano(p: {
    id: string;
    alimento: string;
    metaDiariaGramas: { toNumber(): number };
    limiteDiarioGramas: { toNumber(): number } | null;
    refeicoesPorDia: number;
    dataInicio: Date;
  }): PlanoAlimentar {
    return {
      id: p.id,
      alimento: p.alimento,
      metaDiariaGramas: p.metaDiariaGramas.toNumber(),
      limiteDiarioGramas: p.limiteDiarioGramas?.toNumber(),
      refeicoesPorDia: p.refeicoesPorDia,
      dataInicio: p.dataInicio.toISOString().slice(0, 10),
    };
  }

  private respostaRefeicao(r: {
    id: string;
    dataHora: Date;
    alimento: string;
    quantidadeGramas: { toNumber(): number };
    observacao: string | null;
  }): Refeicao {
    return {
      id: r.id,
      dataHora: r.dataHora.toISOString(),
      alimento: r.alimento,
      quantidadeGramas: r.quantidadeGramas.toNumber(),
      observacao: r.observacao ?? undefined,
    };
  }
}
