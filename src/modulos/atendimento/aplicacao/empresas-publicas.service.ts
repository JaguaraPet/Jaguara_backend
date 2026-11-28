import { Injectable } from '@nestjs/common';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import {
  coordenadasValidas,
  distanciaKm,
  type Coordenadas,
} from '../dominio/distancia';
import { Geocodificador } from '../infra/geocodificador';
import { AvaliacoesService } from './avaliacoes.service';
import type { CategoriaServico } from './catalogo.service';

export type TipoEmpresa =
  | 'CLINICA_VETERINARIA'
  | 'PET_SHOP'
  | 'HOTEL_PET'
  | 'CRECHE'
  | 'CASA_DE_CUIDADO';

export interface EmpresaPublica {
  id: string;
  nomeFantasia: string;
  tipo: TipoEmpresa;
  bairro: string;
  cidade: string;
  uf: string;
  categorias: CategoriaServico[];
  /** Perfil público editado pela empresa */
  slug?: string;
  descricao?: string;
  telefone?: string;
  whatsapp?: string;
  instagram?: string;
  horarioFuncionamento?: string;
  formasPagamento?: string[];
  politicaCancelamento?: string;
  /** Distância até o tutor, quando a busca é por perto. */
  distanciaKm?: number;
  notaMedia?: number;
  totalAvaliacoes: number;
  /** Menor preço entre os serviços ativos, em reais. */
  precoAPartirDe?: number;
}

export interface FiltroEmpresas {
  busca?: string;
  tipo?: TipoEmpresa;
  categoria?: CategoriaServico;
  cidade?: string;
  /** Ordena por distância a partir da localização, do CEP informado ou do CEP do tutor. */
  perto?: boolean;
  latitude?: number;
  longitude?: number;
  cep?: string;
  pagina: number;
  tamanho: number;
}

/**
 * Catálogo público para o tutor (UC-33): só empresas ativas com pelo menos um serviço ativo
 * aparecem na busca, e só os dados públicos (sem CNPJ, e-mail ou endereço completo).
 */
@Injectable()
export class EmpresasPublicasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly avaliacoes: AvaliacoesService,
    private readonly geocodificador: Geocodificador,
  ) {}

  async buscar(filtro: FiltroEmpresas, usuarioId?: string) {
    const busca = filtro.busca?.trim();
    const servicoAtivo = {
      ativo: true,
      ...(filtro.categoria ? { categoria: filtro.categoria } : {}),
    };
    const where = {
      usuario: { status: 'ATIVA' as const },
      // Clínicas de demonstração só aparecem para a tutora da própria demonstração.
      // (dentro de AND para não colidir com o OR da busca por texto)
      AND: [
        {
          OR: [
            { demonstracao: { is: null } },
            ...(usuarioId
              ? [{ demonstracao: { is: { tutorId: usuarioId } } }]
              : []),
          ],
        },
      ],
      servico: { some: servicoAtivo },
      ...(filtro.tipo ? { tipo: filtro.tipo } : {}),
      ...(filtro.cidade
        ? {
            enderecoCidade: {
              equals: filtro.cidade.trim(),
              mode: 'insensitive' as const,
            },
          }
        : {}),
      ...(busca
        ? {
            OR: [
              {
                nomeFantasia: { contains: busca, mode: 'insensitive' as const },
              },
              {
                servico: {
                  some: {
                    ...servicoAtivo,
                    nome: { contains: busca, mode: 'insensitive' as const },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const incluir = {
      servico: {
        where: { ativo: true },
        select: { categoria: true, preco: true },
      },
    };
    const origem = await this.origem(filtro, usuarioId);
    if (!origem) {
      const [total, empresas] = await this.prisma.$transaction([
        this.prisma.empresaEnterprise.count({ where }),
        this.prisma.empresaEnterprise.findMany({
          where,
          include: incluir,
          orderBy: { nomeFantasia: 'asc' },
          skip: (filtro.pagina - 1) * filtro.tamanho,
          take: filtro.tamanho,
        }),
      ]);
      return {
        itens: await this.comNotas(empresas.map((e) => this.publica(e))),
        total,
        pagina: filtro.pagina,
        tamanho: filtro.tamanho,
      };
    }
    // Por perto: ordena todas as que combinam pela distância; sem coordenadas, vão para o fim.
    const empresas = await this.prisma.empresaEnterprise.findMany({
      where,
      include: incluir,
    });
    await this.completarCoordenadas(empresas);
    const ordenadas = empresas
      .map((e) => ({
        ...this.publica(e),
        distanciaKm:
          e.latitude !== null && e.longitude !== null
            ? distanciaKm(origem, {
                latitude: Number(e.latitude),
                longitude: Number(e.longitude),
              })
            : undefined,
      }))
      .sort(
        (a, b) =>
          (a.distanciaKm ?? Infinity) - (b.distanciaKm ?? Infinity) ||
          a.nomeFantasia.localeCompare(b.nomeFantasia),
      );
    const inicio = (filtro.pagina - 1) * filtro.tamanho;
    return {
      itens: await this.comNotas(
        ordenadas.slice(inicio, inicio + filtro.tamanho),
      ),
      total: ordenadas.length,
      pagina: filtro.pagina,
      tamanho: filtro.tamanho,
    };
  }

  /** De onde medir a distância: a localização do aparelho, o CEP digitado ou o CEP do tutor. */
  private async origem(
    filtro: FiltroEmpresas,
    usuarioId?: string,
  ): Promise<Coordenadas | null> {
    if (coordenadasValidas(filtro.latitude, filtro.longitude)) {
      return { latitude: filtro.latitude!, longitude: filtro.longitude! };
    }
    if (filtro.cep) return this.geocodificador.doCep(filtro.cep);
    if (filtro.perto && usuarioId) {
      const tutor = await this.prisma.tutor.findUnique({
        where: { id: usuarioId },
        select: { enderecoCep: true },
      });
      if (tutor?.enderecoCep)
        return this.geocodificador.doCep(tutor.enderecoCep);
    }
    return null;
  }

  /** Busca e guarda as coordenadas de até 20 empresas que ainda não têm, pelo CEP. */
  private async completarCoordenadas(
    empresas: {
      id: string;
      enderecoCep: string;
      latitude: unknown;
      longitude: unknown;
    }[],
  ) {
    const faltam = empresas.filter((e) => e.latitude === null).slice(0, 20);
    for (const e of faltam) {
      const c = await this.geocodificador.doCep(e.enderecoCep);
      if (!c) continue;
      await this.prisma.empresaEnterprise.update({
        where: { id: e.id },
        data: { latitude: c.latitude, longitude: c.longitude },
      });
      e.latitude = c.latitude;
      e.longitude = c.longitude;
    }
  }

  private async comNotas(itens: EmpresaPublica[]): Promise<EmpresaPublica[]> {
    const notas = await this.avaliacoes.resumoDe(itens.map((i) => i.id));
    return itens.map((i) => {
      const resumo = notas.get(i.id);
      return {
        ...i,
        notaMedia: resumo?.media ?? undefined,
        totalAvaliacoes: resumo?.total ?? 0,
      };
    });
  }

  async perfil(empresaId: string): Promise<EmpresaPublica> {
    const empresa = await this.prisma.empresaEnterprise.findFirst({
      where: { id: empresaId, usuario: { status: 'ATIVA' } },
      include: {
        servico: {
          where: { ativo: true },
          select: { categoria: true, preco: true },
        },
      },
    });
    if (!empresa) throw Erros.naoEncontrado('Empresa não encontrada');
    const [comNota] = await this.comNotas([this.publica(empresa)]);
    return comNota;
  }

  private publica(e: {
    id: string;
    nomeFantasia: string;
    tipo: TipoEmpresa;
    enderecoBairro: string;
    enderecoCidade: string;
    enderecoUf: string;
    slug: string | null;
    descricao: string | null;
    telefonePublico: string | null;
    whatsapp: string | null;
    instagram: string | null;
    horarioFuncionamento: string | null;
    formasPagamento: string[];
    politicaCancelamento: string | null;
    servico: { categoria: CategoriaServico; preco: { toNumber(): number } }[];
  }): EmpresaPublica {
    const precos = e.servico.map((s) => s.preco.toNumber());
    return {
      id: e.id,
      nomeFantasia: e.nomeFantasia,
      tipo: e.tipo,
      bairro: e.enderecoBairro,
      cidade: e.enderecoCidade,
      uf: e.enderecoUf,
      categorias: [...new Set(e.servico.map((s) => s.categoria))].sort(),
      slug: e.slug ?? undefined,
      descricao: e.descricao ?? undefined,
      telefone: e.telefonePublico ?? undefined,
      whatsapp: e.whatsapp ?? undefined,
      instagram: e.instagram ?? undefined,
      horarioFuncionamento: e.horarioFuncionamento ?? undefined,
      formasPagamento: e.formasPagamento,
      politicaCancelamento: e.politicaCancelamento ?? undefined,
      totalAvaliacoes: 0,
      precoAPartirDe: precos.length ? Math.min(...precos) : undefined,
    };
  }
}
