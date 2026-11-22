import { Injectable } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import {
  hojeBrasilia,
  instanteBrasilia,
  somarDias,
} from '../../notificacao/dominio/lembretes';
import { agrupar, percentual } from '../dominio/relatorio-empresa';
import type { Periodo } from './relatorios-empresa.service';

export interface Indicadores extends Periodo {
  atendimentos: number;
  faturamento: number;
  taxaAceite: number;
  solicitacoes: number;
  servicosMaisSolicitados: { servico: string; quantidade: number }[];
  atendimentosPorDia: { data: string; quantidade: number }[];
}

/** Indicadores de BI da própria empresa (UC-17, RN21). */
@Injectable()
export class IndicadoresService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * CT-17-01 e CT-17-02: só os dados da empresa do usuário, no período pedido. Nem o
   * administrador da plataforma vê o BI de uma empresa (RN21).
   */
  async consultar(
    usuario: UsuarioAutenticado,
    empresaId: string,
    periodo: Periodo,
  ): Promise<Indicadores> {
    if (usuario.empresaId !== empresaId) {
      throw Erros.semPermissao(
        'Os indicadores mostram só os dados da sua empresa.',
      );
    }
    if (periodo.de > periodo.ate) {
      throw Erros.dadosInvalidos(
        'ate',
        'A data final precisa ser igual ou posterior à inicial.',
      );
    }
    if (somarDias(periodo.de, 366) < periodo.ate) {
      throw Erros.dadosInvalidos('ate', 'Escolha um período de até um ano.');
    }
    const intervalo = {
      gte: instanteBrasilia(periodo.de, '00:00'),
      lt: instanteBrasilia(somarDias(periodo.ate, 1), '00:00'),
    };
    const [realizados, pagamentos, solicitacoes] = await Promise.all([
      this.prisma.agendamento.findMany({
        where: {
          servico: { empresaId },
          status: 'REALIZADO',
          dataHoraInicio: intervalo,
        },
        select: { dataHoraInicio: true },
      }),
      this.prisma.pagamento.findMany({
        where: {
          recebedorId: empresaId,
          status: 'ACEITO',
          dataHora: intervalo,
        },
        select: { valor: true },
      }),
      this.prisma.solicitacaoServico.findMany({
        where: { servico: { empresaId }, dataSolicitacao: intervalo },
        select: { status: true, servico: { select: { nome: true } } },
      }),
    ]);
    const respondidas = solicitacoes.filter((s) =>
      ['ACEITA', 'RECUSADA', 'CONCLUIDA'].includes(s.status),
    );
    const aceitas = respondidas.filter((s) => s.status !== 'RECUSADA');
    const porDia = new Map(
      agrupar(realizados, (a) => hojeBrasilia(a.dataHoraInicio)).map((c) => [
        c.chave,
        c.quantidade,
      ]),
    );
    const dias: string[] = [];
    for (let d = periodo.de; d <= periodo.ate; d = somarDias(d, 1))
      dias.push(d);
    return {
      ...periodo,
      atendimentos: realizados.length,
      faturamento:
        pagamentos.reduce(
          (t, p) => t + Math.round(p.valor.toNumber() * 100),
          0,
        ) / 100,
      taxaAceite: percentual(aceitas.length, respondidas.length),
      solicitacoes: solicitacoes.length,
      servicosMaisSolicitados: agrupar(solicitacoes, (s) => s.servico.nome)
        .slice(0, 5)
        .map((c) => ({ servico: c.chave, quantidade: c.quantidade })),
      atendimentosPorDia: dias.map((data) => ({
        data,
        quantidade: porDia.get(data) ?? 0,
      })),
    };
  }
}
