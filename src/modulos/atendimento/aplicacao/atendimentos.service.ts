import { Injectable } from '@nestjs/common';
import { AuditoriaService } from '../../../compartilhado/auditoria/auditoria.service';
import { garantirMesmaEmpresa } from '../../../compartilhado/auth/escopo-empresa';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import {
  alteracoes,
  jaOcorreu,
  totalDosItens,
  valorDoItem,
} from '../dominio/atendimento';
import type { ItemCobrado } from '../dominio/atendimento';

export interface Atendimento {
  id: string;
  agendamentoId?: string;
  petId: string;
  status: 'EM_ANDAMENTO' | 'FINALIZADO';
  procedimentosRealizados: string;
  observacoesClinicas?: string;
  total: number;
  finalizadoEm?: string;
  itens: ItemCobrado[];
}

const COM_ITENS = { itemAtendimento: true } as const;

/** Registro de serviços e atendimento pela empresa (UC-23, DS-04). */
@Injectable()
export class AtendimentosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * CT-23-01: grava o atendimento já finalizado, com o serviço agendado pelo preço contratado
   * (RN27), e marca o agendamento como REALIZADO, tudo numa transação.
   */
  async registrar(
    usuario: UsuarioAutenticado,
    agendamentoId: string,
    dados: {
      procedimentosRealizados: string;
      observacoesClinicas?: string;
      itens: { servicoId: string; quantidade: number; observacao?: string }[];
    },
  ): Promise<Atendimento> {
    const agendamento = await this.prisma.agendamento.findUnique({
      where: { id: agendamentoId },
      include: { servico: true, atendimento: { select: { id: true } } },
    });
    if (!agendamento) throw Erros.naoEncontrado('Agendamento não encontrado');
    garantirMesmaEmpresa(usuario, agendamento.servico.empresaId);
    if (agendamento.atendimento) {
      throw Erros.conflito(
        'ATENDIMENTO_JA_REGISTRADO',
        'Este agendamento já tem atendimento registrado.',
      );
    }
    if (agendamento.status !== 'AGENDADO') {
      throw Erros.conflito(
        'AGENDAMENTO_INATIVO',
        'Só agendamentos ativos recebem atendimento.',
      );
    }
    if (!jaOcorreu(agendamento.dataHoraInicio, new Date())) {
      throw Erros.conflito(
        'AGENDAMENTO_NAO_OCORREU',
        'Registre o atendimento depois do horário agendado.',
      );
    }

    const ids = [...new Set(dados.itens.map((i) => i.servicoId))];
    const servicos = await this.prisma.servico.findMany({
      where: { id: { in: ids } },
    });
    const porId = new Map(servicos.map((s) => [s.id, s]));
    const itens: ItemCobrado[] = dados.itens.map((item, indice) => {
      const servico = porId.get(item.servicoId);
      if (!servico || servico.empresaId !== agendamento.servico.empresaId) {
        throw Erros.dadosInvalidos(
          `itens[${indice}].servicoId`,
          'Escolha um serviço da sua empresa.',
        );
      }
      return {
        servicoId: item.servicoId,
        quantidade: item.quantidade,
        observacao: item.observacao,
        valorUnitario: valorDoItem(
          item,
          {
            servicoId: agendamento.servicoId,
            precoContratado: agendamento.precoContratado.toNumber(),
          },
          servico.preco.toNumber(),
        ),
      };
    });

    const agora = new Date();
    const [criado] = await this.prisma.$transaction([
      this.prisma.atendimento.create({
        data: {
          agendamentoId,
          petId: agendamento.petId,
          registradoPorId: usuario.sub,
          profissionalId: agendamento.profissionalId,
          dataHoraInicio: agendamento.dataHoraInicio,
          dataHoraFim: agora,
          procedimentosRealizados: dados.procedimentosRealizados.trim(),
          observacoesClinicas: dados.observacoesClinicas?.trim() || null,
          status: 'FINALIZADO',
          finalizadoEm: agora,
          itemAtendimento: { create: itens },
        },
        include: COM_ITENS,
      }),
      this.prisma.agendamento.update({
        where: { id: agendamentoId },
        data: { status: 'REALIZADO' },
      }),
    ]);
    return this.resposta(criado);
  }

  /** Consulta pela empresa do agendamento. */
  async doAgendamento(
    usuario: UsuarioAutenticado,
    agendamentoId: string,
  ): Promise<Atendimento> {
    const atendimento = await this.prisma.atendimento.findUnique({
      where: { agendamentoId },
      include: {
        ...COM_ITENS,
        agendamento: { include: { servico: { select: { empresaId: true } } } },
      },
    });
    if (!atendimento?.agendamento)
      throw Erros.naoEncontrado('Atendimento não encontrado');
    garantirMesmaEmpresa(usuario, atendimento.agendamento.servico.empresaId);
    return this.resposta(atendimento);
  }

  /**
   * CT-23-02: atendimento finalizado só muda com justificativa, e a alteração vai para o log
   * de auditoria com o antes e o depois (RN28, DS-04).
   */
  async alterar(
    usuario: UsuarioAutenticado,
    atendimentoId: string,
    dados: {
      observacoesClinicas?: string;
      procedimentosRealizados?: string;
      justificativa: string;
    },
  ): Promise<Atendimento> {
    const atual = await this.prisma.atendimento.findUnique({
      where: { id: atendimentoId },
      include: {
        agendamento: { include: { servico: { select: { empresaId: true } } } },
      },
    });
    if (!atual?.agendamento)
      throw Erros.naoEncontrado('Atendimento não encontrado');
    garantirMesmaEmpresa(usuario, atual.agendamento.servico.empresaId);

    const mudancas = alteracoes(
      {
        observacoesClinicas: atual.observacoesClinicas,
        procedimentosRealizados: atual.procedimentosRealizados,
      },
      {
        observacoesClinicas: dados.observacoesClinicas?.trim(),
        procedimentosRealizados: dados.procedimentosRealizados?.trim(),
      },
    );
    if (mudancas.length === 0) {
      throw Erros.dadosInvalidos(
        'observacoesClinicas',
        'Altere as observações ou os procedimentos.',
      );
    }
    const alterado = await this.prisma.atendimento.update({
      where: { id: atendimentoId },
      data: Object.fromEntries(mudancas.map((m) => [m.campo, m.depois])),
      include: COM_ITENS,
    });
    await this.auditoria.registrar({
      acao: 'ATENDIMENTO_ALTERADO',
      entidade: 'Atendimento',
      entidadeId: atendimentoId,
      nivel: 'CRITICO',
      autorId: usuario.sub,
      detalhes: JSON.stringify({
        justificativa: dados.justificativa.trim(),
        alteracoes: mudancas,
      }),
    });
    return this.resposta(alterado);
  }

  private resposta(a: {
    id: string;
    agendamentoId: string | null;
    petId: string;
    status: 'EM_ANDAMENTO' | 'FINALIZADO';
    procedimentosRealizados: string;
    observacoesClinicas: string | null;
    finalizadoEm: Date | null;
    itemAtendimento: {
      servicoId: string;
      quantidade: number;
      valorUnitario: { toNumber(): number };
      observacao: string | null;
    }[];
  }): Atendimento {
    const itens = a.itemAtendimento.map((i) => ({
      servicoId: i.servicoId,
      quantidade: i.quantidade,
      valorUnitario: i.valorUnitario.toNumber(),
      observacao: i.observacao ?? undefined,
    }));
    return {
      id: a.id,
      agendamentoId: a.agendamentoId ?? undefined,
      petId: a.petId,
      status: a.status,
      procedimentosRealizados: a.procedimentosRealizados,
      observacoesClinicas: a.observacoesClinicas ?? undefined,
      total: totalDosItens(itens),
      finalizadoEm: a.finalizadoEm?.toISOString(),
      itens,
    };
  }
}
