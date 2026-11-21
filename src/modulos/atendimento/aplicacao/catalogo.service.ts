import { Injectable } from '@nestjs/common';
import { garantirMesmaEmpresa } from '../../../compartilhado/auth/escopo-empresa';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';

export type CategoriaServico =
  | 'CONSULTA'
  | 'EXAME'
  | 'CIRURGIA'
  | 'VACINACAO'
  | 'BANHO_TOSA'
  | 'HOSPEDAGEM'
  | 'PET_SITTER'
  | 'CRECHE'
  | 'OUTRO';

export type TipoRecurso = 'SALA' | 'EQUIPAMENTO' | 'BAIA' | 'VEICULO' | 'OUTRO';

export interface ServicoEntrada {
  nome: string;
  descricao: string;
  categoria: CategoriaServico;
  preco: number;
  duracaoMinutos: number;
  ativo?: boolean;
}

export interface Servico extends Required<ServicoEntrada> {
  id: string;
  empresaId: string;
}

export interface RecursoEntrada {
  nome: string;
  tipo: TipoRecurso;
  ativo?: boolean;
}

export interface Recurso extends Required<RecursoEntrada> {
  id: string;
  empresaId: string;
}

/**
 * Catálogo de serviços e recursos da empresa (UC-38). O preço contratado fica gravado no
 * agendamento, por isso mudar o preço do serviço não altera o que já foi contratado (RN27).
 */
@Injectable()
export class CatalogoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A própria empresa vê todo o catálogo, inclusive serviços desativados. Tutores e outras
   * empresas veem só os ativos (UC-33).
   */
  async listarServicos(
    usuario: UsuarioAutenticado,
    empresaId: string,
  ): Promise<Servico[]> {
    await this.garantirEmpresa(empresaId);
    const daEmpresa = usuario.empresaId === empresaId;
    const servicos = await this.prisma.servico.findMany({
      where: { empresaId, ...(daEmpresa ? {} : { ativo: true }) },
      orderBy: [{ categoria: 'asc' }, { nome: 'asc' }],
    });
    return servicos.map((s) => this.servico(s));
  }

  async criarServico(
    usuario: UsuarioAutenticado,
    empresaId: string,
    dados: ServicoEntrada,
  ): Promise<Servico> {
    garantirMesmaEmpresa(usuario, empresaId);
    const criado = await this.prisma.servico.create({
      data: {
        empresaId,
        nome: dados.nome.trim(),
        descricao: dados.descricao.trim(),
        categoria: dados.categoria,
        preco: dados.preco,
        duracaoMinutos: dados.duracaoMinutos,
        ativo: dados.ativo ?? true,
      },
    });
    return this.servico(criado);
  }

  /** Editar ou desativar ("excluir" do catálogo ativo, FA2) um serviço. */
  async alterarServico(
    usuario: UsuarioAutenticado,
    servicoId: string,
    dados: ServicoEntrada,
  ): Promise<Servico> {
    const atual = await this.prisma.servico.findUnique({
      where: { id: servicoId },
    });
    if (!atual) throw Erros.naoEncontrado('Serviço não encontrado');
    garantirMesmaEmpresa(usuario, atual.empresaId);
    const alterado = await this.prisma.servico.update({
      where: { id: servicoId },
      data: {
        nome: dados.nome.trim(),
        descricao: dados.descricao.trim(),
        categoria: dados.categoria,
        preco: dados.preco,
        duracaoMinutos: dados.duracaoMinutos,
        ativo: dados.ativo ?? atual.ativo,
      },
    });
    return this.servico(alterado);
  }

  async listarRecursos(
    usuario: UsuarioAutenticado,
    empresaId: string,
  ): Promise<Recurso[]> {
    garantirMesmaEmpresa(usuario, empresaId);
    const recursos = await this.prisma.recurso.findMany({
      where: { empresaId },
      orderBy: [{ tipo: 'asc' }, { nome: 'asc' }],
    });
    return recursos.map((r) => this.recurso(r));
  }

  async criarRecurso(
    usuario: UsuarioAutenticado,
    empresaId: string,
    dados: RecursoEntrada,
  ): Promise<Recurso> {
    garantirMesmaEmpresa(usuario, empresaId);
    const criado = await this.prisma.recurso.create({
      data: {
        empresaId,
        nome: dados.nome.trim(),
        tipo: dados.tipo,
        ativo: dados.ativo ?? true,
      },
    });
    return this.recurso(criado);
  }

  async alterarRecurso(
    usuario: UsuarioAutenticado,
    recursoId: string,
    dados: RecursoEntrada,
  ): Promise<Recurso> {
    const atual = await this.prisma.recurso.findUnique({
      where: { id: recursoId },
    });
    if (!atual) throw Erros.naoEncontrado('Recurso não encontrado');
    garantirMesmaEmpresa(usuario, atual.empresaId);
    const alterado = await this.prisma.recurso.update({
      where: { id: recursoId },
      data: {
        nome: dados.nome.trim(),
        tipo: dados.tipo,
        ativo: dados.ativo ?? atual.ativo,
      },
    });
    return this.recurso(alterado);
  }

  private async garantirEmpresa(empresaId: string) {
    const empresa = await this.prisma.empresaEnterprise.findUnique({
      where: { id: empresaId },
      select: { id: true },
    });
    if (!empresa) throw Erros.naoEncontrado('Empresa não encontrada');
  }

  private servico(s: {
    id: string;
    empresaId: string;
    nome: string;
    descricao: string;
    categoria: CategoriaServico;
    preco: { toNumber(): number } | number;
    duracaoMinutos: number;
    ativo: boolean;
  }): Servico {
    return {
      id: s.id,
      empresaId: s.empresaId,
      nome: s.nome,
      descricao: s.descricao,
      categoria: s.categoria,
      preco: typeof s.preco === 'number' ? s.preco : s.preco.toNumber(),
      duracaoMinutos: s.duracaoMinutos,
      ativo: s.ativo,
    };
  }

  private recurso(r: {
    id: string;
    empresaId: string;
    nome: string;
    tipo: TipoRecurso;
    ativo: boolean;
  }): Recurso {
    return {
      id: r.id,
      empresaId: r.empresaId,
      nome: r.nome,
      tipo: r.tipo,
      ativo: r.ativo,
    };
  }
}
