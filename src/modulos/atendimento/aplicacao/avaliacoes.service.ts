import { Injectable } from '@nestjs/common';
import { garantirMesmaEmpresa } from '../../../compartilhado/auth/escopo-empresa';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { AgendaNotificacoesService } from '../../notificacao/aplicacao/agenda-notificacoes.service';
import { PoliticaAcessoPet } from '../../pet/aplicacao/politica-acesso-pet';
import {
  dentroDoPrazo,
  DIAS_PARA_AVALIAR,
  notaValida,
  primeiroNome,
  resumir,
  type ResumoAvaliacoes,
} from '../dominio/avaliacao';

export interface Avaliacao {
  id: string;
  agendamentoId: string;
  nota: number;
  comentario?: string;
  resposta?: string;
  respondidaEm?: string;
  criadoEm: string;
  autor: string;
  servico: string;
  pet: string;
}

export interface AvaliacaoPendente {
  agendamentoId: string;
  realizadoEm: string;
  empresaId: string;
  empresa: string;
  slug?: string;
  servicoId: string;
  servico: string;
  petId: string;
  pet: string;
  /** O que a empresa registrou no atendimento (resumo para o tutor). */
  procedimentos?: string;
}

const COM_DETALHES = {
  autor: { select: { nome: true } },
  agendamento: {
    select: {
      servico: { select: { nome: true } },
      pet: { select: { nome: true } },
    },
  },
} as const;

/**
 * Avaliação depois do atendimento: o tutor responsável dá uma nota de 1 a 5 em até 30 dias,
 * a empresa responde, e a média aparece na busca e na página pública da empresa.
 */
@Injectable()
export class AvaliacoesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly politicaPet: PoliticaAcessoPet,
    private readonly notificacoes: AgendaNotificacoesService,
  ) {}

  async avaliar(
    usuario: UsuarioAutenticado,
    agendamentoId: string,
    dados: { nota: number; comentario?: string },
  ): Promise<Avaliacao> {
    const agendamento = await this.prisma.agendamento.findUnique({
      where: { id: agendamentoId },
      include: { servico: { select: { empresaId: true } } },
    });
    if (!agendamento) throw Erros.naoEncontrado('Agendamento não encontrado');
    const nivel = await this.politicaPet.nivel(usuario, agendamento.petId);
    if (nivel !== 'RESPONSAVEL_PRINCIPAL' && nivel !== 'RESPONSAVEL') {
      throw Erros.semPermissao();
    }
    if (agendamento.status !== 'REALIZADO') {
      throw Erros.conflito(
        'AGENDAMENTO_NAO_REALIZADO',
        'Só dá para avaliar um atendimento que já aconteceu.',
      );
    }
    if (!dentroDoPrazo(agendamento.dataHoraFim, new Date())) {
      throw Erros.conflito(
        'PRAZO_AVALIACAO_ENCERRADO',
        `O prazo para avaliar é de ${DIAS_PARA_AVALIAR} dias.`,
      );
    }
    if (!notaValida(dados.nota)) {
      throw Erros.dadosInvalidos('nota', 'Dê uma nota de 1 a 5.');
    }
    const comentario = dados.comentario?.trim() || null;
    const existente = await this.prisma.avaliacao.findUnique({
      where: { agendamentoId },
      select: { autorId: true },
    });
    if (existente && existente.autorId !== usuario.sub) {
      throw Erros.conflito(
        'AVALIACAO_JA_FEITA',
        'Outro responsável já avaliou este atendimento.',
      );
    }
    const salva = await this.prisma.avaliacao.upsert({
      where: { agendamentoId },
      create: {
        agendamentoId,
        empresaId: agendamento.servico.empresaId,
        autorId: usuario.sub,
        nota: dados.nota,
        comentario,
      },
      update: { nota: dados.nota, comentario },
      include: COM_DETALHES,
    });
    return this.resposta(salva);
  }

  /** Atendimentos dos pets do tutor nos últimos 30 dias que ainda não têm avaliação. */
  async pendentes(usuario: UsuarioAutenticado): Promise<AvaliacaoPendente[]> {
    const desde = new Date(Date.now() - DIAS_PARA_AVALIAR * 86_400_000);
    const agendamentos = await this.prisma.agendamento.findMany({
      where: {
        status: 'REALIZADO',
        dataHoraFim: { gte: desde },
        avaliacao: { is: null },
        pet: {
          responsavelPet: { some: { tutorId: usuario.sub, ativo: true } },
        },
      },
      include: {
        pet: { select: { nome: true } },
        atendimento: { select: { procedimentosRealizados: true } },
        servico: {
          select: {
            id: true,
            nome: true,
            empresa: { select: { id: true, nomeFantasia: true, slug: true } },
          },
        },
      },
      orderBy: { dataHoraFim: 'desc' },
      take: 10,
    });
    return agendamentos.map((a) => ({
      agendamentoId: a.id,
      realizadoEm: a.dataHoraFim.toISOString(),
      empresaId: a.servico.empresa.id,
      empresa: a.servico.empresa.nomeFantasia,
      slug: a.servico.empresa.slug ?? undefined,
      servicoId: a.servico.id,
      servico: a.servico.nome,
      petId: a.petId,
      pet: a.pet.nome,
      procedimentos: a.atendimento?.procedimentosRealizados ?? undefined,
    }));
  }

  /** Lista da empresa, com o resumo das notas. */
  async daEmpresa(
    usuario: UsuarioAutenticado,
    empresaId: string,
    pagina = 1,
    tamanho = 20,
  ) {
    garantirMesmaEmpresa(usuario, empresaId);
    const [todas, itens] = await Promise.all([
      this.prisma.avaliacao.findMany({
        where: { empresaId },
        select: { nota: true },
      }),
      this.prisma.avaliacao.findMany({
        where: { empresaId },
        include: COM_DETALHES,
        orderBy: { criadoEm: 'desc' },
        skip: (pagina - 1) * tamanho,
        take: tamanho,
      }),
    ]);
    return {
      resumo: resumir(todas.map((a) => a.nota)),
      itens: itens.map((a) => this.resposta(a)),
      pagina,
      tamanho,
    };
  }

  async responder(
    usuario: UsuarioAutenticado,
    empresaId: string,
    avaliacaoId: string,
    resposta: string,
  ): Promise<Avaliacao> {
    garantirMesmaEmpresa(usuario, empresaId);
    const avaliacao = await this.prisma.avaliacao.findFirst({
      where: { id: avaliacaoId, empresaId },
      select: { id: true },
    });
    if (!avaliacao) throw Erros.naoEncontrado('Avaliação não encontrada');
    const texto = resposta.trim();
    const salva = await this.prisma.avaliacao.update({
      where: { id: avaliacaoId },
      data: {
        resposta: texto || null,
        respondidaEm: texto ? new Date() : null,
      },
      include: COM_DETALHES,
    });
    return this.resposta(salva);
  }

  /** Média e total por empresa, para a busca do app. */
  async resumoDe(empresaIds: string[]): Promise<Map<string, ResumoAvaliacoes>> {
    if (empresaIds.length === 0) return new Map();
    const notas = await this.prisma.avaliacao.findMany({
      where: { empresaId: { in: empresaIds } },
      select: { empresaId: true, nota: true },
    });
    const porEmpresa = new Map<string, number[]>();
    for (const n of notas) {
      porEmpresa.set(n.empresaId, [
        ...(porEmpresa.get(n.empresaId) ?? []),
        n.nota,
      ]);
    }
    return new Map(
      empresaIds.map((id) => [id, resumir(porEmpresa.get(id) ?? [])]),
    );
  }

  /** Para a página pública: resumo e as últimas avaliações com comentário. */
  async publicas(empresaId: string) {
    const [resumo, recentes] = await Promise.all([
      this.resumoDe([empresaId]).then((m) => m.get(empresaId)!),
      this.prisma.avaliacao.findMany({
        where: { empresaId, comentario: { not: null } },
        include: COM_DETALHES,
        orderBy: { criadoEm: 'desc' },
        take: 5,
      }),
    ]);
    return {
      ...resumo,
      recentes: recentes.map((a) => {
        const { autor, ...resto } = this.resposta(a);
        return { ...resto, autor: primeiroNome(autor) };
      }),
    };
  }

  /** Pede a avaliação aos responsáveis pelo pet duas horas depois do atendimento. */
  async pedirAvaliacao(agendamentoId: string): Promise<void> {
    const agendamento = await this.prisma.agendamento.findUnique({
      where: { id: agendamentoId },
      include: {
        pet: { select: { nome: true } },
        servico: {
          select: { nome: true, empresa: { select: { nomeFantasia: true } } },
        },
      },
    });
    if (!agendamento) return;
    const responsaveis = await this.notificacoes.responsaveisDoPet(
      agendamento.petId,
    );
    const daqui2h = new Date(Date.now() + 2 * 3_600_000);
    await this.notificacoes.agendar(
      responsaveis.map((destinatarioId) => ({
        destinatarioId,
        titulo: `Como foi o ${agendamento.servico.nome.toLowerCase()} de ${agendamento.pet.nome}?`,
        mensagem: `Conte como foi na ${agendamento.servico.empresa.nomeFantasia}. Sua nota ajuda outros tutores.`,
        dataReferencia: daqui2h,
        antecedenciaMinutos: 0,
        tipoEvento: 'COMPROMISSO',
        origemTipo: 'AVALIACAO',
        origemId: agendamentoId,
      })),
    );
  }

  private resposta(a: {
    id: string;
    agendamentoId: string;
    nota: number;
    comentario: string | null;
    resposta: string | null;
    respondidaEm: Date | null;
    criadoEm: Date;
    autor: { nome: string };
    agendamento: { servico: { nome: string }; pet: { nome: string } };
  }): Avaliacao {
    return {
      id: a.id,
      agendamentoId: a.agendamentoId,
      nota: a.nota,
      comentario: a.comentario ?? undefined,
      resposta: a.resposta ?? undefined,
      respondidaEm: a.respondidaEm?.toISOString(),
      criadoEm: a.criadoEm.toISOString(),
      autor: a.autor.nome,
      servico: a.agendamento.servico.nome,
      pet: a.agendamento.pet.nome,
    };
  }
}
