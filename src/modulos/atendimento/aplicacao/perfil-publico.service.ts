import { Injectable } from '@nestjs/common';
import { garantirMesmaEmpresa } from '../../../compartilhado/auth/escopo-empresa';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { gerarSlug, PADRAO_SLUG, SLUGS_RESERVADOS } from '../dominio/slug';

export const FORMAS_PAGAMENTO = [
  'PIX',
  'CARTAO_CREDITO',
  'CARTAO_DEBITO',
  'DINHEIRO',
  'BOLETO',
] as const;

export interface DadosPerfilPublico {
  slug?: string;
  descricao?: string | null;
  telefonePublico?: string | null;
  whatsapp?: string | null;
  instagram?: string | null;
  horarioFuncionamento?: string | null;
  formasPagamento?: string[];
  politicaCancelamento?: string | null;
}

const CAMPOS = {
  id: true,
  nomeFantasia: true,
  tipo: true,
  slug: true,
  descricao: true,
  telefonePublico: true,
  whatsapp: true,
  instagram: true,
  horarioFuncionamento: true,
  formasPagamento: true,
  politicaCancelamento: true,
  enderecoLogradouro: true,
  enderecoNumero: true,
  enderecoBairro: true,
  enderecoCidade: true,
  enderecoUf: true,
} as const;

const vazioParaNulo = (v?: string | null) => {
  const t = v?.trim();
  return t ? t : null;
};

/**
 * Perfil público da empresa: o que o tutor vê no app e na página /e/{slug}, que a empresa
 * divulga no Instagram e no WhatsApp. Só a própria empresa edita.
 */
@Injectable()
export class PerfilPublicoService {
  constructor(private readonly prisma: PrismaService) {}

  async ler(usuario: UsuarioAutenticado, empresaId: string) {
    garantirMesmaEmpresa(usuario, empresaId);
    await this.garantirSlug(empresaId);
    return this.prisma.empresaEnterprise.findUniqueOrThrow({
      where: { id: empresaId },
      select: CAMPOS,
    });
  }

  async atualizar(
    usuario: UsuarioAutenticado,
    empresaId: string,
    dados: DadosPerfilPublico,
  ) {
    garantirMesmaEmpresa(usuario, empresaId);
    if (dados.slug !== undefined) {
      const slug = dados.slug.trim().toLowerCase();
      if (!PADRAO_SLUG.test(slug) || SLUGS_RESERVADOS.has(slug)) {
        throw Erros.dadosInvalidos(
          'slug',
          'Use de 3 a 80 letras minúsculas, números e hífens, sem começar ou terminar com hífen.',
        );
      }
      const dono = await this.prisma.empresaEnterprise.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (dono && dono.id !== empresaId) {
        throw Erros.conflito(
          'SLUG_EM_USO',
          'Este endereço já é de outra empresa.',
        );
      }
    }
    const formas = dados.formasPagamento?.filter((f) =>
      (FORMAS_PAGAMENTO as readonly string[]).includes(f),
    );
    return this.prisma.empresaEnterprise.update({
      where: { id: empresaId },
      data: {
        ...(dados.slug !== undefined
          ? { slug: dados.slug.trim().toLowerCase() }
          : {}),
        ...(dados.descricao !== undefined
          ? { descricao: vazioParaNulo(dados.descricao) }
          : {}),
        ...(dados.telefonePublico !== undefined
          ? { telefonePublico: vazioParaNulo(dados.telefonePublico) }
          : {}),
        ...(dados.whatsapp !== undefined
          ? { whatsapp: vazioParaNulo(dados.whatsapp) }
          : {}),
        ...(dados.instagram !== undefined
          ? {
              instagram:
                vazioParaNulo(dados.instagram)?.replace(/^@/, '') ?? null,
            }
          : {}),
        ...(dados.horarioFuncionamento !== undefined
          ? { horarioFuncionamento: vazioParaNulo(dados.horarioFuncionamento) }
          : {}),
        ...(formas !== undefined
          ? { formasPagamento: [...new Set(formas)] }
          : {}),
        ...(dados.politicaCancelamento !== undefined
          ? { politicaCancelamento: vazioParaNulo(dados.politicaCancelamento) }
          : {}),
      },
      select: CAMPOS,
    });
  }

  /** Página pública /e/{slug}: sem login, com os serviços ativos e os preços. */
  async vitrine(slug: string) {
    const empresa = await this.prisma.empresaEnterprise.findFirst({
      where: { slug: slug.toLowerCase(), usuario: { status: 'ATIVA' } },
      select: {
        ...CAMPOS,
        servico: {
          where: { ativo: true },
          select: {
            id: true,
            nome: true,
            categoria: true,
            preco: true,
            duracaoMinutos: true,
          },
          orderBy: { nome: 'asc' },
        },
      },
    });
    if (!empresa) throw Erros.naoEncontrado('Empresa não encontrada');
    const { servico, ...dados } = empresa;
    return {
      ...dados,
      servicos: servico.map((s) => ({
        id: s.id,
        nome: s.nome,
        categoria: s.categoria,
        preco: Number(s.preco).toFixed(2),
        duracaoMinutos: s.duracaoMinutos,
      })),
    };
  }

  /** Toda empresa ganha um endereço a partir do nome; o primeiro livre vence. */
  async garantirSlug(empresaId: string): Promise<string> {
    const empresa = await this.prisma.empresaEnterprise.findUniqueOrThrow({
      where: { id: empresaId },
      select: { slug: true, nomeFantasia: true },
    });
    if (empresa.slug) return empresa.slug;
    const base = gerarSlug(empresa.nomeFantasia) || 'empresa';
    for (let n = 1; n < 50; n++) {
      const candidato = n === 1 ? base : `${base}-${n}`;
      if (SLUGS_RESERVADOS.has(candidato) || candidato.length < 3) continue;
      const existe = await this.prisma.empresaEnterprise.findUnique({
        where: { slug: candidato },
        select: { id: true },
      });
      if (!existe) {
        await this.prisma.empresaEnterprise.update({
          where: { id: empresaId },
          data: { slug: candidato },
        });
        return candidato;
      }
    }
    const reserva = `${base}-${empresaId.slice(0, 8)}`;
    await this.prisma.empresaEnterprise.update({
      where: { id: empresaId },
      data: { slug: reserva },
    });
    return reserva;
  }
}
