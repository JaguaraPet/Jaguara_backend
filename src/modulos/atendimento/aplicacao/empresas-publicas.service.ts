import { Injectable } from '@nestjs/common';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
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
}

export interface FiltroEmpresas {
  busca?: string;
  tipo?: TipoEmpresa;
  categoria?: CategoriaServico;
  cidade?: string;
  pagina: number;
  tamanho: number;
}

/**
 * Catálogo público para o tutor (UC-33): só empresas ativas com pelo menos um serviço ativo
 * aparecem na busca, e só os dados públicos (sem CNPJ, e-mail ou endereço completo).
 */
@Injectable()
export class EmpresasPublicasService {
  constructor(private readonly prisma: PrismaService) {}

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
    const [total, empresas] = await this.prisma.$transaction([
      this.prisma.empresaEnterprise.count({ where }),
      this.prisma.empresaEnterprise.findMany({
        where,
        include: {
          servico: { where: { ativo: true }, select: { categoria: true } },
        },
        orderBy: { nomeFantasia: 'asc' },
        skip: (filtro.pagina - 1) * filtro.tamanho,
        take: filtro.tamanho,
      }),
    ]);
    return {
      itens: empresas.map((e) => this.publica(e)),
      total,
      pagina: filtro.pagina,
      tamanho: filtro.tamanho,
    };
  }

  async perfil(empresaId: string): Promise<EmpresaPublica> {
    const empresa = await this.prisma.empresaEnterprise.findFirst({
      where: { id: empresaId, usuario: { status: 'ATIVA' } },
      include: {
        servico: { where: { ativo: true }, select: { categoria: true } },
      },
    });
    if (!empresa) throw Erros.naoEncontrado('Empresa não encontrada');
    return this.publica(empresa);
  }

  private publica(e: {
    id: string;
    nomeFantasia: string;
    tipo: TipoEmpresa;
    enderecoBairro: string;
    enderecoCidade: string;
    enderecoUf: string;
    servico: { categoria: CategoriaServico }[];
  }): EmpresaPublica {
    return {
      id: e.id,
      nomeFantasia: e.nomeFantasia,
      tipo: e.tipo,
      bairro: e.enderecoBairro,
      cidade: e.enderecoCidade,
      uf: e.enderecoUf,
      categorias: [...new Set(e.servico.map((s) => s.categoria))].sort(),
    };
  }
}
