import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Ambiente } from '../../../compartilhado/config/ambiente';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { inicioDoDiaBrasilia } from '../../atendimento/dominio/disponibilidade';
import {
  ContextoPet,
  excedeuLimite,
  idadeAproximada,
  prepararHistorico,
  PROVEDOR_ASSISTENTE,
  RESPOSTA_INDISPONIVEL,
} from '../dominio/assistente';
import type { ProvedorAssistente } from '../dominio/assistente';
import { assinaturaVigente } from '../dominio/conversa';
import { AssistenteIndisponivel } from '../infra/assistente-anthropic';

/** Assistente virtual do UC-43: elegibilidade, limite diário e respostas do provedor de IA. */
@Injectable()
export class AssistenteService {
  private readonly log = new Logger(AssistenteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Ambiente, true>,
    @Inject(PROVEDOR_ASSISTENTE) private readonly provedor: ProvedorAssistente,
  ) {}

  /** RN25: só com a assinatura PANTERA ativa e dentro do prazo. */
  async temPantera(tutorId: string): Promise<boolean> {
    const assinaturas = await this.prisma.assinatura.findMany({
      where: { tutorId, plano: 'PANTERA', status: 'ATIVA' },
    });
    const hoje = new Date();
    return assinaturas.some((a) => assinaturaVigente(a, hoje));
  }

  /** Confere a assinatura de novo e o limite de mensagens do dia (ARQ-03, seção 3.5). */
  async garantirEnvio(tutorId: string): Promise<void> {
    if (!(await this.temPantera(tutorId))) throw Erros.assinaturaNecessaria();
    const hoje = new Date().toLocaleDateString('sv-SE', {
      timeZone: 'America/Sao_Paulo',
    });
    const enviadas = await this.prisma.mensagem.count({
      where: {
        remetenteId: tutorId,
        dataHoraEnvio: { gte: inicioDoDiaBrasilia(hoje) },
        conversa: { tipo: 'ASSISTENTE_VIRTUAL' },
      },
    });
    const limite = this.config.get('IA_LIMITE_DIARIO', { infer: true });
    if (excedeuLimite(enviadas, limite)) throw Erros.limiteAssistente(limite);
  }

  /** Gera a resposta à última mensagem do tutor; falha vira aviso na conversa. */
  async responder(conversa: {
    id: string;
    petId: string | null;
  }): Promise<string> {
    const [mensagens, pet] = await Promise.all([
      this.prisma.mensagem.findMany({
        where: { conversaId: conversa.id },
        orderBy: { dataHoraEnvio: 'desc' },
        take: 30,
      }),
      this.contextoPet(conversa.petId),
    ]);
    const historico = prepararHistorico(
      mensagens.reverse().map((m) => ({
        papel: m.remetenteId ? ('tutor' as const) : ('assistente' as const),
        texto: m.conteudo,
      })),
    );
    if (historico.length === 0) return RESPOSTA_INDISPONIVEL;
    try {
      return await this.provedor.responder({ historico, pet });
    } catch (erro) {
      if (!(erro instanceof AssistenteIndisponivel)) {
        this.log.error(`Falha no assistente: ${String(erro)}`);
      }
      return RESPOSTA_INDISPONIVEL;
    }
  }

  /** Só espécie, raça, idade aproximada e alergias saem para o provedor (ARQ-02). */
  private async contextoPet(petId: string | null): Promise<ContextoPet | null> {
    if (!petId) return null;
    const pet = await this.prisma.pet.findUnique({
      where: { id: petId },
      include: {
        raca: { include: { especie: true } },
        alergiaRestricao: { select: { descricao: true, gravidade: true } },
      },
    });
    if (!pet) return null;
    return {
      nome: pet.nome,
      especie: pet.raca.especie.nome,
      raca: pet.raca.nome,
      idade: idadeAproximada(pet.dataNascimento, new Date()),
      alergias: pet.alergiaRestricao.map(
        (a) => `${a.descricao} (gravidade ${a.gravidade.toLowerCase()})`,
      ),
    };
  }
}
