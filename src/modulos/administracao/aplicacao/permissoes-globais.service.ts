import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SessoesRevogadas } from '../../../compartilhado/auth/sessoes-revogadas';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import type { Ambiente } from '../../../compartilhado/config/ambiente';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { PERMISSOES } from '../../acesso/dominio/catalogo-permissoes';
import {
  categoriaDaPermissao,
  categoriaDoPerfil,
  problemaNasPermissoes,
} from '../dominio/permissoes-globais';
import type { CategoriaPerfil } from '../dominio/permissoes-globais';

export interface PerfilGlobal {
  id: string;
  nome: string;
  descricao?: string;
  categoria: CategoriaPerfil;
  permissoes: string[];
  usuarios: number;
}

export interface PermissaoCatalogo {
  codigo: string;
  modulo: string;
  descricao: string;
  /** Perfil a que a permissão pertence; vazio quando vale para mais de um. */
  categoria?: CategoriaPerfil;
}

/** Matriz de acesso dos perfis globais (UC-29, RN35). */
@Injectable()
export class PermissoesGlobaisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revogadas: SessoesRevogadas,
    private readonly config: ConfigService<Ambiente, true>,
  ) {}

  catalogo(): PermissaoCatalogo[] {
    return Object.entries(PERMISSOES).map(([codigo, p]) => ({
      codigo,
      modulo: p.modulo,
      descricao: p.descricao,
      categoria: categoriaDaPermissao(codigo) ?? undefined,
    }));
  }

  async listar(): Promise<PerfilGlobal[]> {
    const perfis = await this.prisma.perfilAcesso.findMany({
      where: { escopo: 'GLOBAL', empresaId: null },
      include: {
        perfilPermissao: { include: { permissao: true } },
        _count: { select: { usuario: true } },
      },
      orderBy: { nome: 'asc' },
    });
    return perfis.map((p) => ({
      id: p.id,
      nome: p.nome,
      descricao: p.descricao ?? undefined,
      categoria: categoriaDoPerfil(p.nome),
      permissoes: p.perfilPermissao.map((pp) => pp.permissao.codigo).sort(),
      usuarios: p._count.usuario,
    }));
  }

  /** CT-29-01: a mudança vale na próxima requisição de quem usa o perfil (RN35). */
  async alterar(
    admin: UsuarioAutenticado,
    perfilId: string,
    permissoes: string[],
  ): Promise<PerfilGlobal> {
    const perfil = await this.prisma.perfilAcesso.findUnique({
      where: { id: perfilId },
    });
    if (!perfil || perfil.escopo !== 'GLOBAL' || perfil.empresaId) {
      throw Erros.naoEncontrado('Perfil global não encontrado');
    }
    const codigos = [...new Set(permissoes)];
    const problema = problemaNasPermissoes(
      categoriaDoPerfil(perfil.nome),
      codigos,
    );
    if (problema) throw Erros.dadosInvalidos('permissoes', problema);
    // Quem altera não pode tirar de si mesmo a gestão de acesso.
    if (perfil.nome === admin.perfil && !codigos.includes('admin:usuarios')) {
      throw Erros.conflito(
        'RN35_AUTOBLOQUEIO',
        'Você usa este perfil: manter admin:usuarios evita perder o acesso a esta tela.',
      );
    }
    const ids = await this.prisma.permissao.findMany({
      where: { codigo: { in: codigos } },
      select: { id: true },
    });
    await this.prisma.$transaction([
      this.prisma.perfilPermissao.deleteMany({
        where: { perfilAcessoId: perfilId },
      }),
      this.prisma.perfilPermissao.createMany({
        data: ids.map((p) => ({ perfilAcessoId: perfilId, permissaoId: p.id })),
      }),
    ]);
    await this.revogadas.marcarPerfilAlterado(
      perfil.nome,
      this.config.get('JWT_EXPIRACAO_MINUTOS', { infer: true }) * 60,
    );
    const atualizado = (await this.listar()).find((p) => p.id === perfilId);
    return atualizado!;
  }
}
