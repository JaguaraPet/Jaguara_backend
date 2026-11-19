import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import {
  PERFIS_EMPRESA_PADRAO,
  PERFIS_GLOBAIS,
  PERMISSOES,
} from '../dominio/catalogo-permissoes';

/** Perfil global da conta principal de uma empresa (antes de ela criar perfis próprios). */
export const PERFIL_EMPRESA = {
  nome: 'Empresa',
  descricao: 'Conta principal de uma empresa Enterprise',
  permissoes: PERFIS_EMPRESA_PADRAO.Proprietário.permissoes,
};

/**
 * Mantém no banco o catálogo de permissões e os perfis globais definidos no código (RN20),
 * em todo ambiente, na inicialização da API. Só acrescenta o que falta: perfis editados pelo
 * administrador não perdem permissões.
 */
@Injectable()
export class CatalogoAcessoService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CatalogoAcessoService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    await this.sincronizar();
  }

  async sincronizar(): Promise<void> {
    const ids = new Map<string, string>();
    for (const [codigo, p] of Object.entries(PERMISSOES)) {
      const permissao = await this.prisma.permissao.upsert({
        where: { codigo },
        create: { codigo, modulo: p.modulo, descricao: p.descricao },
        update: { modulo: p.modulo, descricao: p.descricao },
      });
      ids.set(codigo, permissao.id);
    }

    const globais = [
      { nome: 'Tutor', ...PERFIS_GLOBAIS.Tutor },
      { nome: 'Administrador', ...PERFIS_GLOBAIS.Administrador },
      PERFIL_EMPRESA,
    ];
    for (const perfil of globais) {
      const existente =
        (await this.prisma.perfilAcesso.findFirst({
          where: { nome: perfil.nome, escopo: 'GLOBAL', empresaId: null },
        })) ??
        (await this.prisma.perfilAcesso.create({
          data: {
            nome: perfil.nome,
            descricao: perfil.descricao,
            escopo: 'GLOBAL',
          },
        }));
      await this.prisma.perfilPermissao.createMany({
        data: perfil.permissoes.map((codigo) => ({
          perfilAcessoId: existente.id,
          permissaoId: ids.get(codigo)!,
        })),
        skipDuplicates: true,
      });
    }
    this.logger.log(`Catálogo de acesso sincronizado: ${ids.size} permissões`);
  }

  /** Perfis padrão de uma empresa nova: Proprietário, Atendente e Profissional (RN20). */
  async criarPerfisDaEmpresa(
    empresaId: string,
    prisma: Pick<PrismaService, 'perfilAcesso' | 'permissao'> = this.prisma,
  ): Promise<void> {
    const permissoes = await prisma.permissao.findMany({
      select: { id: true, codigo: true },
    });
    const ids = new Map(permissoes.map((p) => [p.codigo, p.id]));
    for (const [nome, p] of Object.entries(PERFIS_EMPRESA_PADRAO)) {
      await prisma.perfilAcesso.create({
        data: {
          nome,
          descricao: p.descricao,
          escopo: 'EMPRESA',
          empresaId,
          perfilPermissao: {
            create: p.permissoes.map((codigo) => ({
              permissaoId: ids.get(codigo)!,
            })),
          },
        },
      });
    }
  }
}
