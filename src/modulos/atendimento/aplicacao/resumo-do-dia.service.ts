import { Injectable } from '@nestjs/common';
import { garantirMesmaEmpresa } from '../../../compartilhado/auth/escopo-empresa';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { DESLOCAMENTO_BRASILIA_MIN } from '../dominio/disponibilidade';

const DIA_MS = 86_400_000;
const LIMITE_LISTA = 6;

/** Data de hoje em Brasília (AAAA-MM-DD). */
export function hojeEmBrasilia(agora = new Date()): string {
  return new Date(agora.getTime() + DESLOCAMENTO_BRASILIA_MIN * 60_000)
    .toISOString()
    .slice(0, 10);
}

/** Início do dia (em Brasília) de uma data AAAA-MM-DD, como instante UTC. */
function inicioDoDia(data: string): Date {
  const [a, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d) - DESLOCAMENTO_BRASILIA_MIN * 60_000);
}

/**
 * Tela "Hoje" da empresa: tudo o que a recepção e a equipe precisam ver ao abrir o sistema,
 * numa consulta só. A agenda e os pedidos seguem a permissão de agenda; cobranças só aparecem
 * para quem vê o financeiro.
 */
@Injectable()
export class ResumoDoDiaService {
  constructor(private readonly prisma: PrismaService) {}

  async resumo(
    usuario: UsuarioAutenticado,
    empresaId: string,
    agora = new Date(),
  ) {
    garantirMesmaEmpresa(usuario, empresaId);
    const data = hojeEmBrasilia(agora);
    const inicio = inicioDoDia(data);
    const fim = new Date(inicio.getTime() + DIA_MS);
    const veFinanceiro =
      usuario.tipo !== 'FUNCIONARIO' ||
      usuario.permissoes.includes('financeiro:ler');

    const clienteDaEmpresa = { cliente: { empresaId } };
    const nomeDoTutor = {
      clientePet: {
        where: clienteDaEmpresa,
        select: { cliente: { select: { nome: true, telefone: true } } },
        take: 1,
      },
    };

    const [
      agendamentos,
      pendentes,
      totalPendentes,
      cobrancas,
      recebidoSemana,
      atendidosSemana,
    ] = await Promise.all([
      this.prisma.agendamento.findMany({
        where: {
          servico: { empresaId },
          dataHoraInicio: { gte: inicio, lt: fim },
        },
        include: {
          servico: { select: { nome: true } },
          profissional: { select: { id: true, nome: true } },
          recurso: { select: { nome: true } },
          atendimento: { select: { id: true, status: true } },
          pagamento: { select: { status: true } },
          pet: {
            select: {
              id: true,
              nome: true,
              raca: { select: { especie: { select: { nome: true } } } },
              alergiaRestricao: {
                select: { descricao: true, gravidade: true },
              },
              ...nomeDoTutor,
            },
          },
        },
        orderBy: { dataHoraInicio: 'asc' },
      }),
      this.prisma.solicitacaoServico.findMany({
        where: { status: 'PENDENTE', servico: { empresaId } },
        include: {
          servico: { select: { nome: true } },
          pet: { select: { nome: true } },
          tutor: { select: { nome: true } },
        },
        orderBy: { dataHoraDesejada: 'asc' },
        take: LIMITE_LISTA,
      }),
      this.prisma.solicitacaoServico.count({
        where: { status: 'PENDENTE', servico: { empresaId } },
      }),
      veFinanceiro
        ? this.prisma.pagamento.findMany({
            where: { recebedorId: empresaId, status: 'PENDENTE' },
            include: {
              pagador: { select: { nome: true } },
              agendamento: {
                select: {
                  pet: { select: { nome: true } },
                  servico: { select: { nome: true } },
                },
              },
            },
            orderBy: { dataHora: 'desc' },
          })
        : Promise.resolve(null),
      veFinanceiro
        ? this.prisma.pagamento.aggregate({
            where: {
              recebedorId: empresaId,
              status: 'ACEITO',
              dataConfirmacao: {
                gte: new Date(fim.getTime() - 7 * DIA_MS),
                lt: fim,
              },
            },
            _sum: { valor: true },
          })
        : Promise.resolve(null),
      this.prisma.atendimento.count({
        where: {
          status: 'FINALIZADO',
          agendamento: { servico: { empresaId } },
          finalizadoEm: { gte: new Date(fim.getTime() - 7 * DIA_MS), lt: fim },
        },
      }),
    ]);

    return {
      data,
      agenda: agendamentos.map((a) => ({
        id: a.id,
        inicio: a.dataHoraInicio.toISOString(),
        fim: a.dataHoraFim.toISOString(),
        status: a.status,
        servicoNome: a.servico.nome,
        petId: a.pet.id,
        petNome: a.pet.nome,
        especie: a.pet.raca.especie.nome,
        tutorNome: a.pet.clientePet[0]?.cliente.nome ?? null,
        profissionalId: a.profissional?.id ?? null,
        profissionalNome: a.profissional?.nome ?? null,
        recursoNome: a.recurso?.nome ?? null,
        alergias: a.pet.alergiaRestricao.map((r) => r.descricao),
        atendimentoId: a.atendimento?.id ?? null,
        atendimentoStatus: a.atendimento?.status ?? null,
        pago: a.pagamento.length
          ? a.pagamento.some((p) => p.status === 'ACEITO')
          : null,
      })),
      solicitacoes: {
        total: totalPendentes,
        itens: pendentes.map((s) => ({
          id: s.id,
          petNome: s.pet.nome,
          tutorNome: s.tutor.nome,
          servicoNome: s.servico.nome,
          dataHoraDesejada: s.dataHoraDesejada.toISOString(),
          observacoes: s.observacoes,
        })),
      },
      cobrancas: cobrancas && {
        total: cobrancas.length,
        valor: cobrancas.reduce((t, p) => t + Number(p.valor), 0).toFixed(2),
        itens: cobrancas.slice(0, LIMITE_LISTA).map((p) => ({
          id: p.id,
          tutorNome: p.pagador.nome,
          petNome: p.agendamento?.pet.nome ?? null,
          descricao: p.agendamento?.servico.nome ?? 'Cobrança',
          valor: Number(p.valor).toFixed(2),
          dataHora: p.dataHora.toISOString(),
        })),
      },
      vacinas: await this.vacinasVencendo(empresaId, inicio),
      semana: {
        faturamento: recebidoSemana
          ? Number(recebidoSemana._sum.valor ?? 0).toFixed(2)
          : null,
        atendimentos: atendidosSemana,
      },
    };
  }

  /**
   * Vacinas dos pets de clientes com a próxima dose atrasada (até 60 dias) ou nos próximos
   * 30 dias. Uma dose mais nova da mesma vacina resolve a anterior. É a lista de quem ligar.
   */
  private async vacinasVencendo(empresaId: string, hoje: Date) {
    const doses = await this.prisma.vacinacao.findMany({
      where: {
        registroClinico: {
          valido: true,
          pet: {
            status: 'ATIVO',
            clientePet: { some: { cliente: { empresaId } } },
          },
        },
      },
      select: {
        nomeVacina: true,
        dataAplicacao: true,
        dataProximaDose: true,
        registroClinico: {
          select: {
            pet: {
              select: {
                id: true,
                nome: true,
                clientePet: {
                  where: { cliente: { empresaId } },
                  select: {
                    cliente: { select: { nome: true, telefone: true } },
                  },
                  take: 1,
                },
              },
            },
          },
        },
      },
      orderBy: { dataAplicacao: 'desc' },
    });
    const vistas = new Set<string>();
    const limiteAntes = new Date(hoje.getTime() - 60 * DIA_MS);
    const limiteDepois = new Date(hoje.getTime() + 30 * DIA_MS);
    const lista: {
      petId: string;
      petNome: string;
      tutorNome: string | null;
      tutorTelefone: string | null;
      vacina: string;
      proximaDose: string;
      atrasada: boolean;
    }[] = [];
    for (const d of doses) {
      const pet = d.registroClinico.pet;
      const chave = `${pet.id}|${d.nomeVacina.toLowerCase()}`;
      if (vistas.has(chave)) continue;
      vistas.add(chave);
      if (!d.dataProximaDose) continue;
      if (d.dataProximaDose < limiteAntes || d.dataProximaDose > limiteDepois)
        continue;
      lista.push({
        petId: pet.id,
        petNome: pet.nome,
        tutorNome: pet.clientePet[0]?.cliente.nome ?? null,
        tutorTelefone: pet.clientePet[0]?.cliente.telefone ?? null,
        vacina: d.nomeVacina,
        proximaDose: d.dataProximaDose.toISOString().slice(0, 10),
        atrasada: d.dataProximaDose < hoje,
      });
    }
    return lista
      .sort((a, b) => a.proximaDose.localeCompare(b.proximaDose))
      .slice(0, 8);
  }
}
