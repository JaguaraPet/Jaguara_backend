import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { PoliticaAcessoPet } from '../../pet/aplicacao/politica-acesso-pet';
import { hojeBrasilia } from '../../notificacao/dominio/lembretes';
import { CATEGORIAS_PADRAO, valorValido } from '../dominio/despesa';

export interface Categoria {
  id: string;
  nome: string;
  descricao?: string;
}

export interface Despesa {
  id: string;
  descricao: string;
  valor: number;
  data: string;
  categoriaId: string;
  categoria: string;
}

const dia = (d: Date) => d.toISOString().slice(0, 10);

/** Despesas do pet e categorias (UC-06, RN10). */
@Injectable()
export class DespesasService implements OnApplicationBootstrap {
  private readonly log = new Logger(DespesasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly politicaPet: PoliticaAcessoPet,
  ) {}

  /** Garante as categorias padrão sem duplicar (nome é único). */
  async onApplicationBootstrap() {
    for (const categoria of CATEGORIAS_PADRAO) {
      await this.prisma.categoriaDespesa.upsert({
        where: { nome: categoria.nome },
        update: {},
        create: categoria,
      });
    }
    this.log.log(`Categorias de despesa: ${CATEGORIAS_PADRAO.length}`);
  }

  async categorias(): Promise<Categoria[]> {
    const categorias = await this.prisma.categoriaDespesa.findMany({
      orderBy: { nome: 'asc' },
    });
    return categorias.map((c) => ({
      id: c.id,
      nome: c.nome,
      descricao: c.descricao ?? undefined,
    }));
  }

  /** CT-06-01: histórico do pet, do mais recente para o mais antigo. */
  async listar(
    usuario: UsuarioAutenticado,
    petId: string,
    filtro: { de?: string; ate?: string; categoriaId?: string },
  ): Promise<Despesa[]> {
    await this.garantirResponsavel(usuario, petId);
    const despesas = await this.prisma.despesa.findMany({
      where: {
        petId,
        ...(filtro.categoriaId ? { categoriaId: filtro.categoriaId } : {}),
        ...(filtro.de || filtro.ate
          ? {
              data: {
                ...(filtro.de ? { gte: new Date(filtro.de) } : {}),
                ...(filtro.ate ? { lte: new Date(filtro.ate) } : {}),
              },
            }
          : {}),
      },
      include: { categoria: true },
      orderBy: [{ data: 'desc' }, { criadoEm: 'desc' }],
    });
    return despesas.map((d) => this.resposta(d));
  }

  /** CT-06-02: toda despesa tem categoria cadastrada (RN10). */
  async registrar(
    usuario: UsuarioAutenticado,
    petId: string,
    dados: {
      descricao: string;
      valor: number;
      data: string;
      categoriaId: string;
    },
  ): Promise<Despesa> {
    await this.garantirResponsavel(usuario, petId);
    if (!valorValido(dados.valor)) {
      throw Erros.dadosInvalidos(
        'valor',
        'Informe um valor maior que zero, com até duas casas decimais.',
      );
    }
    if (dados.data > hojeBrasilia()) {
      throw Erros.dadosInvalidos('data', 'A despesa não pode ser futura.');
    }
    const categoria = await this.prisma.categoriaDespesa.findUnique({
      where: { id: dados.categoriaId },
    });
    if (!categoria) {
      throw Erros.dadosInvalidos('categoriaId', 'Escolha uma categoria.');
    }
    const criada = await this.prisma.despesa.create({
      data: {
        petId,
        descricao: dados.descricao.trim(),
        valor: dados.valor,
        data: new Date(dados.data),
        categoriaId: categoria.id,
      },
      include: { categoria: true },
    });
    return this.resposta(criada);
  }

  /** As despesas são do tutor: só os responsáveis pelo pet veem e registram. */
  async garantirResponsavel(usuario: UsuarioAutenticado, petId: string) {
    const nivel = await this.politicaPet.nivel(usuario, petId);
    if (nivel !== 'RESPONSAVEL_PRINCIPAL' && nivel !== 'RESPONSAVEL')
      throw Erros.naoEncontrado('Pet não encontrado');
  }

  private resposta(d: {
    id: string;
    descricao: string;
    valor: { toNumber(): number };
    data: Date;
    categoriaId: string;
    categoria: { nome: string };
  }): Despesa {
    return {
      id: d.id,
      descricao: d.descricao,
      valor: d.valor.toNumber(),
      data: dia(d.data),
      categoriaId: d.categoriaId,
      categoria: d.categoria.nome,
    };
  }
}
