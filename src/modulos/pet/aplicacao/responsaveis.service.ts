import { Injectable } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { mantemPrincipal, podeAlterarVinculo } from '../dominio/responsaveis';
import type { TipoResponsavel, Vinculo } from '../dominio/responsaveis';

export interface Responsavel {
  tutorId: string;
  nome: string;
  tipo: TipoResponsavel;
  dataVinculo: string;
  voce: boolean;
}

/** Gerenciar responsáveis do pet (UC-05) mantendo sempre um principal (RN09). */
@Injectable()
export class ResponsaveisService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(
    usuario: UsuarioAutenticado,
    petId: string,
  ): Promise<Responsavel[]> {
    await this.vinculoDe(usuario, petId);
    const lista = await this.prisma.responsavelPet.findMany({
      where: { petId, ativo: true },
      include: { tutor: { select: { nome: true } } },
      orderBy: [{ tipo: 'asc' }, { dataVinculo: 'asc' }],
    });
    return lista.map((r) => ({
      tutorId: r.tutorId,
      nome: r.tutor.nome,
      tipo: r.tipo,
      dataVinculo: r.dataVinculo.toISOString(),
      voce: r.tutorId === usuario.sub,
    }));
  }

  /** CT-05-01: o principal vincula outro tutor cadastrado pelo e-mail. */
  async vincular(
    usuario: UsuarioAutenticado,
    petId: string,
    dados: { email: string; tipo: TipoResponsavel },
  ): Promise<Responsavel[]> {
    const autor = await this.vinculoDe(usuario, petId);
    if (!podeAlterarVinculo(autor, '', 'adicionar'))
      throw Erros.semPermissao(
        'Só o responsável principal adiciona responsáveis.',
      );
    const convidado = await this.prisma.usuario.findUnique({
      where: { email: dados.email.trim().toLowerCase() },
      select: { id: true, status: true, tutor: { select: { id: true } } },
    });
    if (!convidado?.tutor || convidado.status !== 'ATIVA') {
      throw Erros.naoEncontrado(
        'Não há tutor ativo com este e-mail. Peça para a pessoa criar a conta no app.',
      );
    }
    const existente = await this.prisma.responsavelPet.findUnique({
      where: { petId_tutorId: { petId, tutorId: convidado.id } },
    });
    if (existente?.ativo) {
      throw Erros.conflito(
        'RESPONSAVEL_JA_VINCULADO',
        'Esta pessoa já é responsável pelo pet.',
      );
    }
    await this.prisma.responsavelPet.upsert({
      where: { petId_tutorId: { petId, tutorId: convidado.id } },
      update: { ativo: true, tipo: dados.tipo, dataVinculo: new Date() },
      create: {
        petId,
        tutorId: convidado.id,
        tipo: dados.tipo,
        ativo: true,
        dataVinculo: new Date(),
      },
    });
    return this.listar(usuario, petId);
  }

  /** Troca entre principal e adicional, sem deixar o pet sem principal (RN09). */
  async mudarTipo(
    usuario: UsuarioAutenticado,
    petId: string,
    tutorId: string,
    tipo: TipoResponsavel,
  ): Promise<Responsavel[]> {
    const autor = await this.vinculoDe(usuario, petId);
    if (!podeAlterarVinculo(autor, tutorId, 'mudarTipo'))
      throw Erros.semPermissao('Só o responsável principal muda os vínculos.');
    await this.garantirPrincipal(petId, { tutorId, novoTipo: tipo });
    await this.prisma.responsavelPet.update({
      where: { petId_tutorId: { petId, tutorId } },
      data: { tipo },
    });
    return this.listar(usuario, petId);
  }

  /** CT-05-02: o único principal não sai; o adicional pode sair por conta própria. */
  async remover(
    usuario: UsuarioAutenticado,
    petId: string,
    tutorId: string,
  ): Promise<void> {
    const autor = await this.vinculoDe(usuario, petId);
    if (!podeAlterarVinculo(autor, tutorId, 'remover'))
      throw Erros.semPermissao(
        'Só o responsável principal remove outros responsáveis.',
      );
    await this.garantirPrincipal(petId, { tutorId, novoTipo: null });
    await this.prisma.responsavelPet.update({
      where: { petId_tutorId: { petId, tutorId } },
      data: { ativo: false },
    });
  }

  private async garantirPrincipal(
    petId: string,
    mudanca: { tutorId: string; novoTipo: TipoResponsavel | null },
  ) {
    const ativos = await this.prisma.responsavelPet.findMany({
      where: { petId, ativo: true },
      select: { tutorId: true, tipo: true },
    });
    if (!ativos.some((v) => v.tutorId === mudanca.tutorId)) {
      throw Erros.naoEncontrado('Responsável não encontrado');
    }
    if (!mantemPrincipal(ativos, mudanca)) {
      throw Erros.conflito(
        'RN09_SEM_PRINCIPAL',
        'O pet precisa de pelo menos um responsável principal. Defina outro principal antes.',
      );
    }
  }

  /** Só responsáveis ativos veem e mexem nos vínculos; para os demais o pet não existe. */
  private async vinculoDe(
    usuario: UsuarioAutenticado,
    petId: string,
  ): Promise<Vinculo> {
    const vinculo = await this.prisma.responsavelPet.findFirst({
      where: { petId, tutorId: usuario.sub, ativo: true },
      select: { tutorId: true, tipo: true },
    });
    if (!vinculo) throw Erros.naoEncontrado('Pet não encontrado');
    return vinculo;
  }
}
