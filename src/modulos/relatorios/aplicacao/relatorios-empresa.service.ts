import { Injectable } from '@nestjs/common';
import { garantirMesmaEmpresa } from '../../../compartilhado/auth/escopo-empresa';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { gerarPdf } from '../../../compartilhado/pdf/documento-pdf';
import type { LinhaPdf } from '../../../compartilhado/pdf/documento-pdf';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import {
  instanteBrasilia,
  somarDias,
} from '../../notificacao/dominio/lembretes';
import { dataBr, reais } from '../../financeiro/dominio/relatorio-despesas';
import {
  agrupar,
  percentual,
  permissoesFaltando,
} from '../dominio/relatorio-empresa';
import type {
  Contagem,
  TipoRelatorioEmpresa,
} from '../dominio/relatorio-empresa';

export interface Periodo {
  de: string;
  ate: string;
}

export interface RelatorioAtendimentos extends Periodo {
  tipo: 'atendimentos';
  total: number;
  taxaComparecimento: number;
  porStatus: Contagem[];
  porServico: Contagem[];
  porProfissional: Contagem[];
  agendamentos: {
    dataHora: string;
    pet: string;
    servico: string;
    profissional?: string;
    status: string;
    atendimentoFinalizado: boolean;
  }[];
}

export interface RelatorioFinanceiro extends Periodo {
  tipo: 'financeiro';
  faturamento: number;
  pagamentosConfirmados: number;
  ticketMedio: number;
  pendentes: { quantidade: number; total: number };
  porServico: Contagem[];
  porMetodo: Contagem[];
}

export type RelatorioEmpresa = RelatorioAtendimentos | RelatorioFinanceiro;

/** Relatórios da empresa, sempre só com os dados dela (UC-18, RN22). */
@Injectable()
export class RelatoriosEmpresaService {
  constructor(private readonly prisma: PrismaService) {}

  /** CT-18-01 e CT-18-02: gera o relatório se o usuário tiver as permissões do tipo. */
  async gerar(
    usuario: UsuarioAutenticado,
    empresaId: string,
    tipo: TipoRelatorioEmpresa,
    periodo: Periodo,
    formato: 'TELA' | 'PDF',
  ): Promise<RelatorioEmpresa> {
    garantirMesmaEmpresa(usuario, empresaId);
    const faltando = permissoesFaltando(tipo, usuario.permissoes);
    if (faltando.length > 0) {
      throw Erros.semPermissao(
        `Seu perfil não permite este relatório (falta ${faltando.join(', ')}).`,
      );
    }
    if (periodo.de > periodo.ate) {
      throw Erros.dadosInvalidos(
        'ate',
        'A data final precisa ser igual ou posterior à inicial.',
      );
    }
    const intervalo = {
      gte: instanteBrasilia(periodo.de, '00:00'),
      lt: instanteBrasilia(somarDias(periodo.ate, 1), '00:00'),
    };
    const relatorio =
      tipo === 'atendimentos'
        ? await this.atendimentos(empresaId, periodo, intervalo)
        : await this.financeiro(empresaId, periodo, intervalo);
    await this.prisma.relatorio.create({
      data: {
        tipo: tipo === 'atendimentos' ? 'OPERACIONAL' : 'GERENCIAL',
        periodoInicio: new Date(periodo.de),
        periodoFim: new Date(periodo.ate),
        filtros: JSON.stringify({ empresaId, tipo }),
        formato,
        geradoEm: new Date(),
        geradoPorId: usuario.sub,
      },
    });
    return relatorio;
  }

  async pdf(
    usuario: UsuarioAutenticado,
    empresaId: string,
    tipo: TipoRelatorioEmpresa,
    periodo: Periodo,
  ): Promise<Buffer> {
    const r = await this.gerar(usuario, empresaId, tipo, periodo, 'PDF');
    const titulo =
      r.tipo === 'atendimentos'
        ? 'Relatório de atendimentos'
        : 'Relatório financeiro';
    const secao = (nome: string, itens: Contagem[], valor: boolean) => [
      { texto: nome, tamanho: 13, negrito: true, antes: 12 },
      ...itens.map((c) => ({
        texto: `${c.chave}: ${c.quantidade}${valor ? ` · ${reais(c.total ?? 0)}` : ''}`,
      })),
    ];
    const linhas: LinhaPdf[] = [
      { texto: `Jaguara · ${titulo}`, tamanho: 16, negrito: true },
      { texto: `Período: ${dataBr(r.de)} a ${dataBr(r.ate)}` },
      ...(r.tipo === 'atendimentos'
        ? [
            { texto: `Agendamentos: ${r.total}`, negrito: true },
            { texto: `Comparecimento: ${r.taxaComparecimento}%` },
            ...secao('Por status', r.porStatus, false),
            ...secao('Por serviço', r.porServico, false),
            ...secao('Por profissional', r.porProfissional, false),
          ]
        : [
            { texto: `Faturamento: ${reais(r.faturamento)}`, negrito: true },
            {
              texto: `Pagamentos confirmados: ${r.pagamentosConfirmados} · ticket médio ${reais(r.ticketMedio)}`,
            },
            {
              texto: `Pendentes: ${r.pendentes.quantidade} · ${reais(r.pendentes.total)}`,
            },
            ...secao('Por serviço', r.porServico, true),
            ...secao('Por método', r.porMetodo, true),
          ]),
    ];
    return gerarPdf(titulo, linhas);
  }

  /** Operacional: agendamentos do período por status, serviço e profissional. */
  private async atendimentos(
    empresaId: string,
    periodo: Periodo,
    intervalo: { gte: Date; lt: Date },
  ): Promise<RelatorioAtendimentos> {
    const agendamentos = await this.prisma.agendamento.findMany({
      where: { servico: { empresaId }, dataHoraInicio: intervalo },
      include: {
        servico: { select: { nome: true } },
        pet: { select: { nome: true } },
        profissional: { select: { nome: true } },
        atendimento: { select: { status: true } },
      },
      orderBy: { dataHoraInicio: 'asc' },
    });
    const realizados = agendamentos.filter((a) => a.status === 'REALIZADO');
    const faltas = agendamentos.filter((a) => a.status === 'NAO_COMPARECEU');
    return {
      tipo: 'atendimentos',
      ...periodo,
      total: agendamentos.length,
      taxaComparecimento: percentual(
        realizados.length,
        realizados.length + faltas.length,
      ),
      porStatus: agrupar(agendamentos, (a) => a.status),
      porServico: agrupar(agendamentos, (a) => a.servico.nome),
      porProfissional: agrupar(
        agendamentos,
        (a) => a.profissional?.nome ?? 'Sem profissional',
      ),
      agendamentos: agendamentos.map((a) => ({
        dataHora: a.dataHoraInicio.toISOString(),
        pet: a.pet.nome,
        servico: a.servico.nome,
        profissional: a.profissional?.nome,
        status: a.status,
        atendimentoFinalizado: a.atendimento?.status === 'FINALIZADO',
      })),
    };
  }

  /** Gerencial: pagamentos recebidos no período, por serviço e por método. */
  private async financeiro(
    empresaId: string,
    periodo: Periodo,
    intervalo: { gte: Date; lt: Date },
  ): Promise<RelatorioFinanceiro> {
    const pagamentos = await this.prisma.pagamento.findMany({
      where: {
        recebedorId: empresaId,
        status: { in: ['ACEITO', 'PENDENTE'] },
        dataHora: intervalo,
      },
      include: {
        agendamento: { select: { servico: { select: { nome: true } } } },
      },
    });
    const valor = (p: (typeof pagamentos)[number]) => p.valor.toNumber();
    const aceitos = pagamentos.filter((p) => p.status === 'ACEITO');
    const pendentes = pagamentos.filter((p) => p.status === 'PENDENTE');
    const soma = (lista: typeof pagamentos) =>
      lista.reduce((t, p) => t + Math.round(valor(p) * 100), 0) / 100;
    const faturamento = soma(aceitos);
    return {
      tipo: 'financeiro',
      ...periodo,
      faturamento,
      pagamentosConfirmados: aceitos.length,
      ticketMedio:
        aceitos.length === 0
          ? 0
          : Math.round((faturamento / aceitos.length) * 100) / 100,
      pendentes: { quantidade: pendentes.length, total: soma(pendentes) },
      porServico: agrupar(
        aceitos,
        (p) => p.agendamento?.servico.nome ?? 'Outros',
        valor,
      ),
      porMetodo: agrupar(aceitos, (p) => p.metodo, valor),
    };
  }
}
