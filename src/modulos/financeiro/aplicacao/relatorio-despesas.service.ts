import { HttpStatus, Injectable } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { ErroNegocio, Erros } from '../../../compartilhado/erros/erro-negocio';
import { gerarPdf } from '../../../compartilhado/pdf/documento-pdf';
import type { LinhaPdf } from '../../../compartilhado/pdf/documento-pdf';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import {
  dataBr,
  reais,
  totaisPorCategoria,
  totalGeral,
} from '../dominio/relatorio-despesas';
import type {
  DespesaDoRelatorio,
  TotalCategoria,
} from '../dominio/relatorio-despesas';
import { DespesasService } from './despesas.service';

export interface RelatorioDespesas {
  de: string;
  ate: string;
  petId?: string;
  total: number;
  porCategoria: TotalCategoria[];
  despesas: DespesaDoRelatorio[];
}

export interface FiltroRelatorio {
  petId?: string;
  de: string;
  ate: string;
}

const dia = (d: Date) => d.toISOString().slice(0, 10);

/** Relatório de despesas por período, na tela ou em PDF (UC-07, RN11). */
@Injectable()
export class RelatorioDespesasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly despesas: DespesasService,
  ) {}

  /** CT-07-01 e CT-07-02: despesas e totais do período, de um pet ou de todos os do tutor. */
  async gerar(
    usuario: UsuarioAutenticado,
    filtro: FiltroRelatorio,
    formato: 'TELA' | 'PDF',
  ): Promise<RelatorioDespesas> {
    if (filtro.de > filtro.ate) {
      throw Erros.dadosInvalidos(
        'ate',
        'A data final precisa ser igual ou posterior à inicial.',
      );
    }
    if (filtro.petId) {
      await this.despesas.garantirResponsavel(usuario, filtro.petId);
    }
    const registros = await this.prisma.despesa.findMany({
      where: {
        data: { gte: new Date(filtro.de), lte: new Date(filtro.ate) },
        pet: {
          ...(filtro.petId ? { id: filtro.petId } : {}),
          responsavelPet: { some: { tutorId: usuario.sub, ativo: true } },
        },
      },
      include: { categoria: true, pet: { select: { nome: true } } },
      orderBy: [{ data: 'asc' }, { criadoEm: 'asc' }],
    });
    if (registros.length === 0) {
      throw new ErroNegocio(
        HttpStatus.NOT_FOUND,
        'RN11_SEM_DADOS',
        'Não há despesas no período',
        'Escolha outro período ou registre as despesas do pet.',
      );
    }
    const despesas = registros.map((d) => ({
      descricao: d.descricao,
      valor: d.valor.toNumber(),
      data: dia(d.data),
      categoria: d.categoria.nome,
      pet: d.pet.nome,
    }));
    await this.prisma.relatorio.create({
      data: {
        tipo: 'DESPESAS',
        periodoInicio: new Date(filtro.de),
        periodoFim: new Date(filtro.ate),
        filtros: filtro.petId ? JSON.stringify({ petId: filtro.petId }) : null,
        formato,
        geradoEm: new Date(),
        geradoPorId: usuario.sub,
      },
    });
    return {
      de: filtro.de,
      ate: filtro.ate,
      petId: filtro.petId,
      total: totalGeral(despesas),
      porCategoria: totaisPorCategoria(despesas),
      despesas,
    };
  }

  /** RN11: o mesmo relatório exportado em PDF. */
  async pdf(
    usuario: UsuarioAutenticado,
    filtro: FiltroRelatorio,
  ): Promise<Buffer> {
    const r = await this.gerar(usuario, filtro, 'PDF');
    const linhas: LinhaPdf[] = [
      { texto: 'Jaguara · Relatório de despesas', tamanho: 16, negrito: true },
      { texto: `Período: ${dataBr(r.de)} a ${dataBr(r.ate)}` },
      { texto: `Total: ${reais(r.total)}`, negrito: true },
      { texto: 'Total por categoria', tamanho: 13, negrito: true, antes: 12 },
      ...r.porCategoria.map((c) => ({
        texto: `${c.categoria}: ${reais(c.total)} (${c.quantidade} ${c.quantidade === 1 ? 'despesa' : 'despesas'})`,
      })),
      { texto: 'Despesas', tamanho: 13, negrito: true, antes: 12 },
      ...r.despesas.map((d) => ({
        texto: `${dataBr(d.data)}  ${d.pet}  ${d.categoria}  ${d.descricao}  ${reais(d.valor)}`,
        tamanho: 10,
      })),
    ];
    return gerarPdf('Relatório de despesas', linhas);
  }
}
