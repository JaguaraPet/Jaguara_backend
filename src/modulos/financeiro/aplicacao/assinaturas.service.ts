import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import type { Ambiente } from '../../../compartilhado/config/ambiente';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { assinaturaVigente } from '../../comunicacao/dominio/conversa';
import { hojeBrasilia } from '../../notificacao/dominio/lembretes';
import { fimDoPeriodo, inicioDoNovoPeriodo } from '../dominio/assinatura';

export type StatusAssinatura = 'PENDENTE' | 'ATIVA' | 'CANCELADA' | 'EXPIRADA';

export interface Assinatura {
  id: string;
  plano: 'GRATUITO' | 'PANTERA';
  status: StatusAssinatura;
  dataInicio: string;
  dataFim?: string;
  precoMensal: number;
}

export interface SituacaoPlano {
  plano: 'GRATUITO' | 'PANTERA';
  vigente: boolean;
  /** Assinatura vigente ou, sem ela, a pendente de pagamento. */
  assinatura?: Assinatura;
  precoMensal: number;
}

const dia = (d: Date) => d.toISOString().slice(0, 10);

/** Assinatura mensal do PANTERA, que libera o assistente virtual (ADR-010, RN25). */
@Injectable()
export class AssinaturasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Ambiente, true>,
  ) {}

  get precoMensal(): number {
    return this.config.get('PANTERA_PRECO_MENSAL', { infer: true });
  }

  /** Plano atual do tutor: PANTERA vigente ou gratuito. */
  async situacao(usuario: UsuarioAutenticado): Promise<SituacaoPlano> {
    const assinaturas = await this.prisma.assinatura.findMany({
      where: { tutorId: usuario.sub, plano: 'PANTERA' },
      orderBy: { criadoEm: 'desc' },
    });
    const hoje = new Date();
    const vigente = assinaturas.find((a) => assinaturaVigente(a, hoje));
    const pendente = assinaturas.find((a) => a.status === 'PENDENTE');
    const mostrar = vigente ?? pendente;
    return {
      plano: vigente ? 'PANTERA' : 'GRATUITO',
      vigente: !!vigente,
      assinatura: mostrar ? this.resposta(mostrar) : undefined,
      precoMensal: this.precoMensal,
    };
  }

  /**
   * UC-43, FA1 ("Tornar-se membro"): cria a assinatura PENDENTE de um mês, que vira ATIVA
   * só com o pagamento confirmado (RN39). Reaproveita a pendente que já existe.
   */
  async assinar(usuario: UsuarioAutenticado): Promise<Assinatura> {
    const pendente = await this.prisma.assinatura.findFirst({
      where: { tutorId: usuario.sub, plano: 'PANTERA', status: 'PENDENTE' },
    });
    if (pendente) return this.resposta(pendente);
    const hoje = hojeBrasilia();
    const criada = await this.prisma.assinatura.create({
      data: {
        tutorId: usuario.sub,
        plano: 'PANTERA',
        status: 'PENDENTE',
        dataInicio: new Date(hoje),
      },
    });
    return this.resposta(criada);
  }

  /** O cancelamento mantém o acesso até o fim do período já pago. */
  async cancelar(usuario: UsuarioAutenticado): Promise<Assinatura> {
    const ativa = await this.prisma.assinatura.findFirst({
      where: { tutorId: usuario.sub, plano: 'PANTERA', status: 'ATIVA' },
      orderBy: { criadoEm: 'desc' },
    });
    if (!ativa) {
      throw Erros.conflito(
        'ASSINATURA_INEXISTENTE',
        'Você não tem assinatura PANTERA ativa.',
      );
    }
    const cancelada = await this.prisma.assinatura.update({
      where: { id: ativa.id },
      data: { status: 'CANCELADA' },
    });
    return this.resposta(cancelada);
  }

  /** Assinatura pendente do tutor, que o pagamento vai ativar (UC-44). */
  async pendenteDoTutor(tutorId: string, assinaturaId: string) {
    const assinatura = await this.prisma.assinatura.findUnique({
      where: { id: assinaturaId },
    });
    if (!assinatura || assinatura.tutorId !== tutorId)
      throw Erros.naoEncontrado('Assinatura não encontrada');
    if (assinatura.status !== 'PENDENTE') {
      throw Erros.conflito(
        'ASSINATURA_JA_PAGA',
        'Esta assinatura não está aguardando pagamento.',
      );
    }
    return assinatura;
  }

  /**
   * Pagamento confirmado: ativa a assinatura por um mês, emendando no fim do período em
   * vigor quando o tutor renova antes de acabar.
   */
  async ativar(assinaturaId: string): Promise<void> {
    const assinatura = await this.prisma.assinatura.findUnique({
      where: { id: assinaturaId },
    });
    if (!assinatura || assinatura.status !== 'PENDENTE') return;
    const anterior = await this.prisma.assinatura.findFirst({
      where: {
        tutorId: assinatura.tutorId,
        plano: 'PANTERA',
        status: { in: ['ATIVA', 'CANCELADA'] },
        id: { not: assinaturaId },
      },
      orderBy: { dataFim: 'desc' },
    });
    const inicio = inicioDoNovoPeriodo(
      hojeBrasilia(),
      anterior?.dataFim ? dia(anterior.dataFim) : null,
    );
    await this.prisma.assinatura.update({
      where: { id: assinaturaId },
      data: {
        status: 'ATIVA',
        dataInicio: new Date(inicio),
        dataFim: new Date(fimDoPeriodo(inicio)),
      },
    });
  }

  private resposta(a: {
    id: string;
    plano: 'GRATUITO' | 'PANTERA';
    status: StatusAssinatura;
    dataInicio: Date;
    dataFim: Date | null;
  }): Assinatura {
    return {
      id: a.id,
      plano: a.plano,
      status: a.status,
      dataInicio: dia(a.dataInicio),
      dataFim: a.dataFim ? dia(a.dataFim) : undefined,
      precoMensal: this.precoMensal,
    };
  }
}
