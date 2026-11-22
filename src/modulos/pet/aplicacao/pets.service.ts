import { Injectable } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { idadeEmAnos, podeExcluirPet } from '../dominio/pet';
import { PoliticaAcessoPet } from './politica-acesso-pet';

export interface PetEntrada {
  nome: string;
  racaId: string;
  dataNascimento?: string;
  sexo: 'MACHO' | 'FEMEA';
  pesoKg?: number;
  cor?: string;
  microchip?: string;
  castrado: boolean;
}

export type StatusPet = 'ATIVO' | 'ARQUIVADO' | 'FALECIDO';

export interface Pet extends PetEntrada {
  id: string;
  especie: string;
  raca: string;
  idade?: number;
  status: StatusPet;
  fotoUrl?: string;
}

const incluirRaca = { raca: { include: { especie: true } } } as const;

/** Cadastro, edição, arquivamento e exclusão de pets (UC-04). */
@Injectable()
export class PetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly politica: PoliticaAcessoPet,
  ) {}

  async listarEspecies() {
    const especies = await this.prisma.especie.findMany({
      include: {
        raca: { orderBy: { nome: 'asc' }, select: { id: true, nome: true } },
      },
      orderBy: { nome: 'asc' },
    });
    return especies.map((e) => ({ id: e.id, nome: e.nome, racas: e.raca }));
  }

  /** Pets de que o tutor é responsável ativo. */
  async listar(
    usuario: UsuarioAutenticado,
    filtro: { status?: StatusPet; pagina: number; tamanho: number },
  ) {
    const where = {
      responsavelPet: { some: { tutorId: usuario.sub, ativo: true } },
      ...(filtro.status ? { status: filtro.status } : {}),
    };
    const [total, pets] = await this.prisma.$transaction([
      this.prisma.pet.count({ where }),
      this.prisma.pet.findMany({
        where,
        include: incluirRaca,
        orderBy: { nome: 'asc' },
        skip: (filtro.pagina - 1) * filtro.tamanho,
        take: filtro.tamanho,
      }),
    ]);
    return {
      itens: pets.map((p) => this.resposta(p)),
      total,
      pagina: filtro.pagina,
    };
  }

  /** CT-04-01: o tutor que cadastra vira responsável principal (RN09). */
  async cadastrar(
    usuario: UsuarioAutenticado,
    dados: PetEntrada,
  ): Promise<Pet> {
    await this.garantirRaca(dados.racaId);
    await this.garantirMicrochipLivre(dados.microchip);
    const pet = await this.prisma.pet.create({
      data: {
        ...this.dados(dados),
        status: 'ATIVO',
        responsavelPet: {
          create: {
            tutorId: usuario.sub,
            tipo: 'PRINCIPAL',
            ativo: true,
            dataVinculo: new Date(),
          },
        },
      },
      include: incluirRaca,
    });
    return this.resposta(pet);
  }

  async consultar(usuario: UsuarioAutenticado, petId: string): Promise<Pet> {
    const pet = await this.buscar(petId);
    if ((await this.politica.nivel(usuario, petId)) === 'NENHUM') {
      throw Erros.semPermissao('Você não tem acesso a este pet.');
    }
    return this.resposta(pet);
  }

  /** Responsáveis editam; a empresa edita só pet de cliente sem conta dela (ADR-010, RN30). */
  async editar(
    usuario: UsuarioAutenticado,
    petId: string,
    dados: PetEntrada,
  ): Promise<Pet> {
    const atual = await this.buscar(petId);
    const nivel = await this.politica.nivel(usuario, petId);
    const daEmpresa =
      nivel === 'EMPRESA' &&
      !!usuario.empresaId &&
      usuario.permissoes.includes('cliente:editar') &&
      (await this.politica.petDeClienteSemConta(usuario.empresaId, petId));
    if (
      nivel !== 'RESPONSAVEL_PRINCIPAL' &&
      nivel !== 'RESPONSAVEL' &&
      !daEmpresa
    ) {
      throw Erros.semPermissao(
        'Só os responsáveis alteram os dados do pet (RN30).',
      );
    }
    await this.garantirRaca(dados.racaId);
    if (dados.microchip && dados.microchip !== atual.microchip)
      await this.garantirMicrochipLivre(dados.microchip);
    const pet = await this.prisma.pet.update({
      where: { id: petId },
      data: this.dados(dados),
      include: incluirRaca,
    });
    return this.resposta(pet);
  }

  async arquivar(usuario: UsuarioAutenticado, petId: string): Promise<void> {
    await this.buscar(petId);
    await this.garantirPrincipal(usuario, petId);
    await this.prisma.pet.update({
      where: { id: petId },
      data: { status: 'ARQUIVADO' },
    });
  }

  /** Desfaz o arquivamento: o pet volta para a lista de ativos. Pet falecido não volta. */
  async desarquivar(usuario: UsuarioAutenticado, petId: string): Promise<void> {
    const pet = await this.buscar(petId);
    await this.garantirPrincipal(usuario, petId);
    if (pet.status !== 'ARQUIVADO') {
      throw Erros.conflito('PET_NAO_ARQUIVADO', 'Este pet não está arquivado.');
    }
    await this.prisma.pet.update({
      where: { id: petId },
      data: { status: 'ATIVO' },
    });
  }

  /** CT-04-02: com histórico clínico ou financeiro, não exclui e indica o arquivamento (RN08). */
  async excluir(usuario: UsuarioAutenticado, petId: string): Promise<void> {
    await this.buscar(petId);
    await this.garantirPrincipal(usuario, petId);
    const [registrosClinicos, despesas, agendamentos] = await Promise.all([
      this.prisma.registroClinico.count({ where: { petId } }),
      this.prisma.despesa.count({ where: { petId } }),
      this.prisma.agendamento.count({ where: { petId } }),
    ]);
    if (!podeExcluirPet({ registrosClinicos, despesas, agendamentos })) {
      throw Erros.conflito(
        'RN08_PET_COM_HISTORICO',
        'Este pet tem histórico clínico ou financeiro e não pode ser excluído. Você pode arquivá-lo.',
      );
    }
    await this.prisma.$transaction([
      this.prisma.responsavelPet.deleteMany({ where: { petId } }),
      this.prisma.clientePet.deleteMany({ where: { petId } }),
      this.prisma.pet.delete({ where: { id: petId } }),
    ]);
  }

  private async buscar(petId: string) {
    const pet = await this.prisma.pet.findUnique({
      where: { id: petId },
      include: incluirRaca,
    });
    if (!pet) throw Erros.naoEncontrado('Pet não encontrado');
    return pet;
  }

  private async garantirPrincipal(usuario: UsuarioAutenticado, petId: string) {
    if (
      (await this.politica.nivel(usuario, petId)) !== 'RESPONSAVEL_PRINCIPAL'
    ) {
      throw Erros.semPermissao(
        'Só o responsável principal arquiva, desarquiva ou exclui o pet.',
      );
    }
  }

  /** RN07: espécie e raça vêm da lista cadastrada. */
  private async garantirRaca(racaId: string) {
    if (
      !(await this.prisma.raca.findUnique({
        where: { id: racaId },
        select: { id: true },
      }))
    ) {
      throw Erros.dadosInvalidos('racaId', 'Escolha uma raça da lista.');
    }
  }

  private async garantirMicrochipLivre(microchip?: string) {
    if (
      microchip &&
      (await this.prisma.pet.findUnique({
        where: { microchip },
        select: { id: true },
      }))
    ) {
      throw Erros.conflito(
        'MICROCHIP_EM_USO',
        'Este microchip já está cadastrado em outro pet.',
      );
    }
  }

  private dados(d: PetEntrada) {
    return {
      nome: d.nome.trim(),
      racaId: d.racaId,
      dataNascimento: d.dataNascimento
        ? new Date(`${d.dataNascimento}T00:00:00Z`)
        : null,
      sexo: d.sexo,
      pesoKg: d.pesoKg ?? null,
      cor: d.cor?.trim() || null,
      microchip: d.microchip?.trim() || null,
      castrado: d.castrado,
    };
  }

  private resposta(p: {
    id: string;
    nome: string;
    racaId: string;
    dataNascimento: Date | null;
    sexo: 'MACHO' | 'FEMEA';
    pesoKg: { toNumber(): number } | null;
    cor: string | null;
    microchip: string | null;
    castrado: boolean;
    status: StatusPet;
    fotoUrl: string | null;
    raca: { nome: string; especie: { nome: string } };
  }): Pet {
    return {
      id: p.id,
      nome: p.nome,
      racaId: p.racaId,
      raca: p.raca.nome,
      especie: p.raca.especie.nome,
      dataNascimento: p.dataNascimento?.toISOString().slice(0, 10),
      idade: idadeEmAnos(p.dataNascimento, new Date()),
      sexo: p.sexo,
      pesoKg: p.pesoKg?.toNumber(),
      cor: p.cor ?? undefined,
      microchip: p.microchip ?? undefined,
      castrado: p.castrado,
      status: p.status,
      fotoUrl: p.fotoUrl ?? undefined,
    };
  }
}
