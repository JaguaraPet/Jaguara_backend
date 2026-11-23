import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { garantirMesmaEmpresa } from '../../../compartilhado/auth/escopo-empresa';
import { SessoesRevogadas } from '../../../compartilhado/auth/sessoes-revogadas';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import type { Ambiente } from '../../../compartilhado/config/ambiente';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { EMPRESA_TODAS, PERMISSOES } from '../dominio/catalogo-permissoes';
import {
  PERFIL_PROTEGIDO,
  mesmoNome,
  problemaNoPerfil,
} from '../dominio/perfis';
import type { PerfilDaEmpresa } from './funcionarios.service';

export interface PermissaoDisponivel {
  codigo: string;
  modulo: string;
  descricao: string;
}

export interface DadosPerfil {
  nome: string;
  descricao?: string;
  permissoes: string[];
}

/** Perfis e permissões da empresa (UC-16, RN20): mudanças valem na hora para quem usa o perfil. */
@Injectable()
export class PerfisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revogadas: SessoesRevogadas,
    private readonly config: ConfigService<Ambiente, true>,
  ) {}

  /** Permissões que a empresa pode distribuir, na ordem do catálogo. */
  permissoesDisponiveis(
    usuario: UsuarioAutenticado,
    empresaId: string,
  ): PermissaoDisponivel[] {
    garantirMesmaEmpresa(usuario, empresaId);
    return EMPRESA_TODAS.map((codigo) => ({
      codigo,
      modulo: PERMISSOES[codigo].modulo,
      descricao: PERMISSOES[codigo].descricao,
    }));
  }

  async criar(
    usuario: UsuarioAutenticado,
    empresaId: string,
    dados: DadosPerfil,
  ): Promise<PerfilDaEmpresa> {
    garantirMesmaEmpresa(usuario, empresaId);
    this.validar(dados);
    await this.garantirNomeLivre(empresaId, dados.nome);
    const perfil = await this.prisma.perfilAcesso.create({
      data: {
        nome: dados.nome.trim(),
        descricao: dados.descricao?.trim() || null,
        escopo: 'EMPRESA',
        empresaId,
        perfilPermissao: {
          create: await this.idsDasPermissoes(dados.permissoes),
        },
      },
    });
    return this.resposta(perfil.id);
  }

  /** CT-16-01: as permissões novas valem na hora para quem já usa o perfil. */
  async alterar(
    usuario: UsuarioAutenticado,
    perfilId: string,
    dados: DadosPerfil,
  ): Promise<PerfilDaEmpresa> {
    const perfil = await this.buscarEditavel(usuario, perfilId);
    this.validar(dados);
    await this.garantirNomeLivre(perfil.empresaId!, dados.nome, perfilId);
    const ids = await this.idsDasPermissoes(dados.permissoes);
    await this.prisma.$transaction([
      this.prisma.perfilPermissao.deleteMany({
        where: { perfilAcessoId: perfilId },
      }),
      this.prisma.perfilAcesso.update({
        where: { id: perfilId },
        data: {
          nome: dados.nome.trim(),
          descricao: dados.descricao?.trim() || null,
          perfilPermissao: { create: ids },
        },
      }),
    ]);
    await this.encerrarSessoesDoPerfil(perfilId);
    return this.resposta(perfilId);
  }

  async excluir(usuario: UsuarioAutenticado, perfilId: string): Promise<void> {
    await this.buscarEditavel(usuario, perfilId);
    const emUso = await this.prisma.usuario.count({ where: { perfilId } });
    if (emUso > 0) {
      throw Erros.conflito(
        'PERFIL_EM_USO',
        `Este perfil está com ${emUso} ${emUso === 1 ? 'pessoa' : 'pessoas'}. Troque o perfil delas antes de excluir.`,
      );
    }
    await this.prisma.perfilAcesso.delete({ where: { id: perfilId } });
  }

  private validar(dados: DadosPerfil) {
    const problema = problemaNoPerfil(dados);
    if (problema) throw Erros.dadosInvalidos(problema.campo, problema.mensagem);
  }

  private async buscarEditavel(usuario: UsuarioAutenticado, perfilId: string) {
    const perfil = await this.prisma.perfilAcesso.findUnique({
      where: { id: perfilId },
    });
    if (!perfil || !perfil.empresaId) {
      throw Erros.naoEncontrado('Perfil não encontrado');
    }
    garantirMesmaEmpresa(usuario, perfil.empresaId);
    if (mesmoNome(perfil.nome, PERFIL_PROTEGIDO)) {
      throw Erros.conflito(
        'PERFIL_PROTEGIDO',
        'O perfil Proprietário é o da conta da empresa e não pode ser alterado.',
      );
    }
    return perfil;
  }

  private async garantirNomeLivre(
    empresaId: string,
    nome: string,
    excetoId?: string,
  ) {
    const perfis = await this.prisma.perfilAcesso.findMany({
      where: { empresaId },
      select: { id: true, nome: true },
    });
    if (perfis.some((p) => p.id !== excetoId && mesmoNome(p.nome, nome))) {
      throw Erros.conflito(
        'PERFIL_DUPLICADO',
        'A empresa já tem um perfil com esse nome.',
      );
    }
  }

  private async idsDasPermissoes(codigos: string[]) {
    const permissoes = await this.prisma.permissao.findMany({
      where: { codigo: { in: [...new Set(codigos)] } },
      select: { id: true },
    });
    return permissoes.map((p) => ({ permissaoId: p.id }));
  }

  private async encerrarSessoesDoPerfil(perfilId: string) {
    const sessoes = await this.prisma.sessao.findMany({
      where: { usuario: { perfilId } },
      select: { id: true },
    });
    if (sessoes.length === 0) return;
    await this.prisma.sessao.deleteMany({
      where: { id: { in: sessoes.map((s) => s.id) } },
    });
    const segundos =
      this.config.get('JWT_EXPIRACAO_MINUTOS', { infer: true }) * 60;
    await Promise.all(
      sessoes.map((s) => this.revogadas.revogar(s.id, segundos)),
    );
  }

  private async resposta(perfilId: string): Promise<PerfilDaEmpresa> {
    const p = await this.prisma.perfilAcesso.findUniqueOrThrow({
      where: { id: perfilId },
      include: { perfilPermissao: { include: { permissao: true } } },
    });
    return {
      id: p.id,
      nome: p.nome,
      descricao: p.descricao ?? undefined,
      permissoes: p.perfilPermissao.map((pp) => pp.permissao.codigo).sort(),
    };
  }
}
