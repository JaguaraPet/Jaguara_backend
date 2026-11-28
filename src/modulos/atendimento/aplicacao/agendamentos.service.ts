import { Injectable } from '@nestjs/common';
import { garantirMesmaEmpresa } from '../../../compartilhado/auth/escopo-empresa';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { PublicadorWebhook } from '../../../compartilhado/webhooks/publicador-webhook';
import { FilaEmailService } from '../../notificacao/aplicacao/fila-email.service';
import { PoliticaAcessoPet } from '../../pet/aplicacao/politica-acesso-pet';
import { inicioDoDiaBrasilia } from '../dominio/disponibilidade';
import { LembretesAgendamentoService } from './lembretes-agendamento.service';
import { SolicitacoesService } from './solicitacoes.service';

export type StatusAgendamento =
  'AGENDADO' | 'CANCELADO' | 'REALIZADO' | 'NAO_COMPARECEU';

export interface Agendamento {
  id: string;
  servicoId: string;
  petId: string;
  dataHoraInicio: string;
  dataHoraFim: string;
  profissionalId?: string;
  recursoId?: string;
  precoContratado: number;
  status: StatusAgendamento;
  /** Quando um responsável confirmou a presença pelo lembrete. */
  confirmadoEm?: string;
}

interface Intervalo {
  inicio: Date;
  fim: Date;
  petId: string;
  profissionalId?: string | null;
  recursoId?: string | null;
  ignorar?: string;
}

/** Agendamento direto pela empresa (UC-39) e agenda semanal (UC-24). */
@Injectable()
export class AgendamentosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly politicaPet: PoliticaAcessoPet,
    private readonly solicitacoes: SolicitacoesService,
    private readonly fila: FilaEmailService,
    private readonly webhooks: PublicadorWebhook,
    private readonly lembretes: LembretesAgendamentoService,
  ) {}

  /** CT-39-01: cria o agendamento com o preço congelado (RN27) e avisa o tutor. */
  async criar(
    usuario: UsuarioAutenticado,
    dados: {
      servicoId: string;
      petId: string;
      dataHoraInicio: string;
      profissionalId?: string;
      recursoId?: string;
    },
  ): Promise<Agendamento> {
    const servico = await this.prisma.servico.findUnique({
      where: { id: dados.servicoId },
    });
    if (!servico || !servico.ativo)
      throw Erros.naoEncontrado('Serviço não encontrado');
    garantirMesmaEmpresa(usuario, servico.empresaId);
    if ((await this.politicaPet.nivel(usuario, dados.petId)) !== 'EMPRESA') {
      throw Erros.semPermissao(
        'O pet precisa ser de um cliente ou estar compartilhado com a empresa.',
      );
    }
    await this.garantirDonos(
      servico.empresaId,
      dados.profissionalId,
      dados.recursoId,
    );
    const inicio = new Date(dados.dataHoraInicio);
    const fim = new Date(inicio.getTime() + servico.duracaoMinutos * 60_000);
    await this.garantirSemConflito({
      inicio,
      fim,
      petId: dados.petId,
      profissionalId: dados.profissionalId,
      recursoId: dados.recursoId,
    });

    const criado = await this.gravar(() =>
      this.prisma.agendamento.create({
        data: {
          servicoId: servico.id,
          petId: dados.petId,
          profissionalId: dados.profissionalId,
          recursoId: dados.recursoId,
          dataHoraInicio: inicio,
          dataHoraFim: fim,
          precoContratado: servico.preco,
          status: 'AGENDADO',
          criadoEm: new Date(),
        },
      }),
    );
    await this.avisarTutor(dados.petId, servico.nome, inicio);
    await this.lembretes.programar(criado.id);
    await this.webhooks.publicar('agendamento.criado', {
      agendamentoId: criado.id,
      servicoId: servico.id,
      empresaId: servico.empresaId,
      dataHoraInicio: criado.dataHoraInicio.toISOString(),
      dataHoraFim: criado.dataHoraFim.toISOString(),
    });
    return this.resposta(criado);
  }

  /** CT-24-02: remarca só agendamento ativo e sem conflito (RN29). */
  async remarcar(
    usuario: UsuarioAutenticado,
    agendamentoId: string,
    dados: {
      dataHoraInicio: string;
      dataHoraFim: string;
      profissionalId?: string;
      recursoId?: string;
    },
  ): Promise<Agendamento> {
    const atual = await this.buscar(agendamentoId);
    garantirMesmaEmpresa(usuario, atual.servico.empresaId);
    if (atual.status !== 'AGENDADO') {
      throw Erros.conflito(
        'AGENDAMENTO_INATIVO',
        'Só agendamentos ativos podem ser remarcados.',
      );
    }
    const inicio = new Date(dados.dataHoraInicio);
    const fim = new Date(dados.dataHoraFim);
    if (fim <= inicio)
      throw Erros.dadosInvalidos(
        'dataHoraFim',
        'O fim precisa ser depois do início.',
      );
    const profissionalId = dados.profissionalId ?? atual.profissionalId;
    const recursoId = dados.recursoId ?? atual.recursoId;
    await this.garantirDonos(
      atual.servico.empresaId,
      dados.profissionalId,
      dados.recursoId,
    );
    await this.garantirSemConflito({
      inicio,
      fim,
      petId: atual.petId,
      profissionalId,
      recursoId,
      ignorar: atual.id,
    });
    const alterado = await this.gravar(() =>
      this.prisma.agendamento.update({
        where: { id: agendamentoId },
        data: {
          dataHoraInicio: inicio,
          dataHoraFim: fim,
          profissionalId,
          recursoId,
          // Novo horário: a confirmação anterior não vale mais.
          confirmadoEm: null,
        },
      }),
    );
    await this.lembretes.reprogramar(agendamentoId);
    return this.resposta(alterado);
  }

  /** A empresa ou um responsável pelo pet cancela; o preço contratado fica registrado. */
  async cancelar(
    usuario: UsuarioAutenticado,
    agendamentoId: string,
  ): Promise<void> {
    const atual = await this.buscar(agendamentoId);
    if (usuario.tipo === 'TUTOR') {
      const nivel = await this.politicaPet.nivel(usuario, atual.petId);
      if (nivel !== 'RESPONSAVEL_PRINCIPAL' && nivel !== 'RESPONSAVEL')
        throw Erros.semPermissao();
    } else {
      garantirMesmaEmpresa(usuario, atual.servico.empresaId);
      if (!usuario.permissoes.includes('agenda:editar'))
        throw Erros.semPermissao();
    }
    if (atual.status !== 'AGENDADO') {
      throw Erros.conflito(
        'AGENDAMENTO_INATIVO',
        'Este agendamento não está mais ativo.',
      );
    }
    await this.prisma.agendamento.update({
      where: { id: agendamentoId },
      data: { status: 'CANCELADO' },
    });
    await this.lembretes.cancelar(agendamentoId);
    await this.webhooks.publicar('agendamento.cancelado', {
      agendamentoId,
      empresaId: atual.servico.empresaId,
      canceladoPor: usuario.tipo === 'TUTOR' ? 'TUTOR' : 'EMPRESA',
    });
  }

  /** O responsável confirma pelo lembrete que vai ao agendamento. */
  async confirmarPresenca(
    usuario: UsuarioAutenticado,
    agendamentoId: string,
  ): Promise<Agendamento> {
    const atual = await this.buscar(agendamentoId);
    const nivel = await this.politicaPet.nivel(usuario, atual.petId);
    if (nivel !== 'RESPONSAVEL_PRINCIPAL' && nivel !== 'RESPONSAVEL') {
      throw Erros.semPermissao();
    }
    if (atual.status !== 'AGENDADO' || atual.dataHoraInicio <= new Date()) {
      throw Erros.conflito(
        'AGENDAMENTO_INATIVO',
        'Este agendamento não está mais ativo.',
      );
    }
    const confirmado = await this.prisma.agendamento.update({
      where: { id: agendamentoId },
      data: { confirmadoEm: atual.confirmadoEm ?? new Date() },
    });
    return this.resposta(confirmado);
  }

  /** Agenda semanal (UC-24): agendamentos e solicitações pendentes da semana. */
  async agenda(
    usuario: UsuarioAutenticado,
    empresaId: string,
    filtro: { semana: string; profissionalId?: string; recursoId?: string },
  ) {
    garantirMesmaEmpresa(usuario, empresaId);
    const inicio = inicioDoDiaBrasilia(filtro.semana);
    const fim = new Date(inicio.getTime() + 7 * 86_400_000);
    const [agendamentos, pendentes] = await Promise.all([
      this.prisma.agendamento.findMany({
        where: {
          servico: { empresaId },
          dataHoraInicio: { gte: inicio, lt: fim },
          ...(filtro.profissionalId
            ? { profissionalId: filtro.profissionalId }
            : {}),
          ...(filtro.recursoId ? { recursoId: filtro.recursoId } : {}),
        },
        include: {
          servico: { select: { nome: true } },
          pet: { select: { nome: true } },
          profissional: { select: { nome: true } },
          recurso: { select: { nome: true } },
        },
        orderBy: { dataHoraInicio: 'asc' },
      }),
      this.solicitacoes.listar(usuario, 'PENDENTE'),
    ]);
    return {
      // Na agenda vão também os nomes, para a tela não precisar de outras consultas.
      agendamentos: agendamentos.map((a) => ({
        ...this.resposta(a),
        servicoNome: a.servico.nome,
        petNome: a.pet.nome,
        profissionalNome: a.profissional?.nome,
        recursoNome: a.recurso?.nome,
      })),
      solicitacoesPendentes: pendentes.filter((s) => {
        const quando = new Date(s.dataHoraDesejada);
        return quando >= inicio && quando < fim;
      }),
    };
  }

  /**
   * UC-41, CT-41-01 (DS-03): a empresa aceita o pedido; o agendamento nasce com o preço
   * atual do serviço (RN27), sem conflito de pet, profissional ou recurso (RN29), e a
   * solicitação vira ACEITA com o histórico (RN38), tudo numa transação. O tutor é avisado.
   */
  async aceitarSolicitacao(
    usuario: UsuarioAutenticado,
    solicitacaoId: string,
    dados: { profissionalId?: string; recursoId?: string },
  ): Promise<Agendamento> {
    const solicitacao = await this.prisma.solicitacaoServico.findUnique({
      where: { id: solicitacaoId },
      include: { servico: true },
    });
    if (!solicitacao) throw Erros.naoEncontrado('Solicitação não encontrada');
    garantirMesmaEmpresa(usuario, solicitacao.servico.empresaId);
    if (solicitacao.status !== 'PENDENTE') {
      throw Erros.conflito(
        'SOLICITACAO_RESPONDIDA',
        'Esta solicitação já foi respondida.',
      );
    }
    await this.garantirDonos(
      solicitacao.servico.empresaId,
      dados.profissionalId,
      dados.recursoId,
    );
    const inicio = solicitacao.dataHoraDesejada;
    const fim = new Date(
      inicio.getTime() + solicitacao.servico.duracaoMinutos * 60_000,
    );
    await this.garantirSemConflito({
      inicio,
      fim,
      petId: solicitacao.petId,
      profissionalId: dados.profissionalId,
      recursoId: dados.recursoId,
    });
    const agora = new Date();
    const criado = await this.gravar(() =>
      this.prisma.$transaction(async (tx) => {
        const { count } = await tx.solicitacaoServico.updateMany({
          where: { id: solicitacaoId, status: 'PENDENTE' },
          data: { status: 'ACEITA' },
        });
        if (count === 0) {
          throw Erros.conflito(
            'SOLICITACAO_RESPONDIDA',
            'Esta solicitação já foi respondida.',
          );
        }
        await tx.historicoSolicitacao.create({
          data: {
            solicitacaoId,
            dataHora: agora,
            statusAnterior: 'PENDENTE',
            statusNovo: 'ACEITA',
            descricao: 'Aceita pela empresa',
            autorId: usuario.sub,
          },
        });
        return tx.agendamento.create({
          data: {
            servicoId: solicitacao.servicoId,
            petId: solicitacao.petId,
            solicitacaoId,
            profissionalId: dados.profissionalId,
            recursoId: dados.recursoId,
            dataHoraInicio: inicio,
            dataHoraFim: fim,
            precoContratado: solicitacao.servico.preco,
            status: 'AGENDADO',
            criadoEm: agora,
          },
        });
      }),
    );
    await this.avisarResposta(solicitacaoId, true);
    await this.lembretes.programar(criado.id);
    await this.webhooks.publicar('solicitacao.status_alterado', {
      solicitacaoId,
      empresaId: solicitacao.servico.empresaId,
      status: 'ACEITA',
    });
    await this.webhooks.publicar('agendamento.criado', {
      agendamentoId: criado.id,
      servicoId: solicitacao.servicoId,
      empresaId: solicitacao.servico.empresaId,
      dataHoraInicio: inicio.toISOString(),
      dataHoraFim: fim.toISOString(),
    });
    return this.resposta(criado);
  }

  /** Avisa o tutor que pediu se a empresa aceitou ou recusou (CT-41-01). */
  async avisarResposta(
    solicitacaoId: string,
    aceita: boolean,
    motivo?: string,
  ): Promise<void> {
    const s = await this.prisma.solicitacaoServico.findUnique({
      where: { id: solicitacaoId },
      include: {
        servico: { include: { empresa: { select: { nomeFantasia: true } } } },
        pet: { select: { nome: true } },
        tutor: { include: { usuario: { select: { email: true } } } },
      },
    });
    if (!s) return;
    await this.fila.enviar('SOLICITACAO_RESPONDIDA', s.tutor.usuario.email, {
      nome: s.tutor.nome,
      empresa: s.servico.empresa.nomeFantasia,
      pet: s.pet.nome,
      servico: s.servico.nome,
      dataHora: s.dataHoraDesejada.toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
      }),
      aceita,
      motivo,
    });
  }

  private async buscar(agendamentoId: string) {
    const agendamento = await this.prisma.agendamento.findUnique({
      where: { id: agendamentoId },
      include: { servico: { select: { empresaId: true } } },
    });
    if (!agendamento) throw Erros.naoEncontrado('Agendamento não encontrado');
    return agendamento;
  }

  private async garantirDonos(
    empresaId: string,
    profissionalId?: string,
    recursoId?: string,
  ) {
    if (profissionalId) {
      const p = await this.prisma.funcionarioEnterprise.findUnique({
        where: { id: profissionalId },
      });
      if (!p || p.empresaId !== empresaId || !p.ativo) {
        throw Erros.dadosInvalidos(
          'profissionalId',
          'Escolha um profissional ativo da sua empresa.',
        );
      }
    }
    if (recursoId) {
      const r = await this.prisma.recurso.findUnique({
        where: { id: recursoId },
      });
      if (!r || r.empresaId !== empresaId || !r.ativo) {
        throw Erros.dadosInvalidos(
          'recursoId',
          'Escolha um recurso ativo da sua empresa.',
        );
      }
    }
  }

  /** RN14 e RN29: mesmo pet, profissional ou recurso não ficam em dois lugares ao mesmo tempo. */
  private async garantirSemConflito(i: Intervalo) {
    const cruzaCom = (extra: object) =>
      this.prisma.agendamento.count({
        where: {
          status: 'AGENDADO',
          dataHoraInicio: { lt: i.fim },
          dataHoraFim: { gt: i.inicio },
          ...(i.ignorar ? { id: { not: i.ignorar } } : {}),
          ...extra,
        },
      });
    if ((await cruzaCom({ petId: i.petId })) > 0) {
      throw Erros.conflito(
        'RN14_CONFLITO_PET',
        'O pet já tem um agendamento neste horário.',
      );
    }
    if (
      i.profissionalId &&
      (await cruzaCom({ profissionalId: i.profissionalId })) > 0
    ) {
      throw Erros.conflito(
        'RN29_CONFLITO_PROFISSIONAL',
        'O profissional já tem um atendimento neste horário.',
      );
    }
    if (i.recursoId && (await cruzaCom({ recursoId: i.recursoId })) > 0) {
      throw Erros.conflito(
        'RN29_CONFLITO_RECURSO',
        'O recurso já está ocupado neste horário.',
      );
    }
  }

  /** A restrição EXCLUDE do banco é a última garantia contra agendamentos simultâneos. */
  private async gravar<T>(operacao: () => Promise<T>): Promise<T> {
    try {
      return await operacao();
    } catch (erro) {
      if (String(erro).includes('ex_agendamento')) {
        throw Erros.conflito(
          'RN29_CONFLITO_AGENDA',
          'O horário acabou de ser ocupado. Escolha outro.',
        );
      }
      throw erro;
    }
  }

  private async avisarTutor(petId: string, servico: string, inicio: Date) {
    const responsavel = await this.prisma.responsavelPet.findFirst({
      where: { petId, tipo: 'PRINCIPAL', ativo: true },
      include: {
        tutor: { include: { usuario: { select: { email: true } } } },
        pet: true,
      },
    });
    if (!responsavel) return;
    await this.fila.enviar(
      'AGENDAMENTO_CRIADO',
      responsavel.tutor.usuario.email,
      {
        nome: responsavel.tutor.nome,
        pet: responsavel.pet.nome,
        servico,
        dataHora: inicio.toLocaleString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
        }),
      },
    );
  }

  private resposta(a: {
    id: string;
    servicoId: string;
    petId: string;
    dataHoraInicio: Date;
    dataHoraFim: Date;
    profissionalId: string | null;
    recursoId: string | null;
    precoContratado: { toNumber(): number };
    status: StatusAgendamento;
    confirmadoEm?: Date | null;
  }): Agendamento {
    return {
      id: a.id,
      servicoId: a.servicoId,
      petId: a.petId,
      dataHoraInicio: a.dataHoraInicio.toISOString(),
      dataHoraFim: a.dataHoraFim.toISOString(),
      profissionalId: a.profissionalId ?? undefined,
      recursoId: a.recursoId ?? undefined,
      precoContratado: a.precoContratado.toNumber(),
      status: a.status,
      confirmadoEm: a.confirmadoEm?.toISOString(),
    };
  }
}
