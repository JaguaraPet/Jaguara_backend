import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Armazenamento } from '../../../compartilhado/arquivos/armazenamento';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { RACA_OUTRA } from '../dominio/catalogo-especies';
import {
  chaveDaFoto,
  idadeEmAnos,
  podeExcluirPet,
  problemaNaFoto,
} from '../dominio/pet';
import { PoliticaAcessoPet } from './politica-acesso-pet';

export interface PetEntrada {
  nome: string;
  racaId: string;
  /** Obrigatória quando a raça escolhida é "Outra (digitar)". */
  racaDescricao?: string;
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
    private readonly armazenamento: Armazenamento,
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
    const raca = await this.garantirRaca(dados);
    await this.garantirMicrochipLivre(dados.microchip);
    const pet = await this.prisma.pet.create({
      data: {
        ...this.dados(dados, raca.outra),
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
    const raca = await this.garantirRaca(dados);
    if (raca.especieId !== atual.raca.especieId) {
      throw Erros.dadosInvalidos(
        'racaId',
        'A espécie não muda depois do cadastro. Se precisar, cadastre outro pet.',
      );
    }
    if (dados.microchip && dados.microchip !== atual.microchip)
      await this.garantirMicrochipLivre(dados.microchip);
    const pet = await this.prisma.pet.update({
      where: { id: petId },
      data: this.dados(dados, raca.outra),
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

  /** RN07: espécie e raça vêm da lista; em "Outra (digitar)", o tutor escreve a raça. */
  private async garantirRaca(dados: PetEntrada) {
    const raca = await this.prisma.raca.findUnique({
      where: { id: dados.racaId },
      select: { nome: true, especieId: true },
    });
    if (!raca) {
      throw Erros.dadosInvalidos('racaId', 'Escolha uma raça da lista.');
    }
    const outra = raca.nome === RACA_OUTRA;
    if (outra && !dados.racaDescricao?.trim()) {
      throw Erros.dadosInvalidos('racaDescricao', 'Escreva a raça do pet.');
    }
    return { especieId: raca.especieId, outra };
  }

  /** Foto do pet: o app envia direto ao armazenamento pela URL assinada. */
  async prepararFoto(
    usuario: UsuarioAutenticado,
    petId: string,
    arquivo: { nomeArquivo: string; tamanhoBytes: number },
  ) {
    await this.buscar(petId);
    await this.garantirResponsavel(usuario, petId);
    const problema = problemaNaFoto(arquivo.nomeArquivo, arquivo.tamanhoBytes);
    if (problema) throw Erros.dadosInvalidos('nomeArquivo', problema);
    const chave = chaveDaFoto(petId, randomUUID(), arquivo.nomeArquivo);
    await this.prisma.pet.update({
      where: { id: petId },
      data: { fotoUrl: chave },
    });
    return { urlEnvio: this.armazenamento.urlEnvio(chave) };
  }

  async removerFoto(usuario: UsuarioAutenticado, petId: string): Promise<void> {
    await this.buscar(petId);
    await this.garantirResponsavel(usuario, petId);
    await this.prisma.pet.update({
      where: { id: petId },
      data: { fotoUrl: null },
    });
  }

  private async garantirResponsavel(
    usuario: UsuarioAutenticado,
    petId: string,
  ) {
    const nivel = await this.politica.nivel(usuario, petId);
    if (nivel !== 'RESPONSAVEL_PRINCIPAL' && nivel !== 'RESPONSAVEL') {
      throw Erros.semPermissao('Só os responsáveis trocam a foto do pet.');
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

  private dados(d: PetEntrada, racaOutra: boolean) {
    return {
      nome: d.nome.trim(),
      racaId: d.racaId,
      racaDescricao: racaOutra ? d.racaDescricao!.trim().slice(0, 80) : null,
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
    racaDescricao: string | null;
    raca: { nome: string; especie: { nome: string } };
  }): Pet {
    return {
      id: p.id,
      nome: p.nome,
      racaId: p.racaId,
      racaDescricao: p.racaDescricao ?? undefined,
      raca: p.racaDescricao ?? p.raca.nome,
      especie: p.raca.especie.nome,
      dataNascimento: p.dataNascimento?.toISOString().slice(0, 10),
      idade: idadeEmAnos(p.dataNascimento, new Date()),
      sexo: p.sexo,
      pesoKg: p.pesoKg?.toNumber(),
      cor: p.cor ?? undefined,
      microchip: p.microchip ?? undefined,
      castrado: p.castrado,
      status: p.status,
      // A foto vale por 6 horas; o app pede o pet de novo ao abrir a tela.
      fotoUrl: p.fotoUrl
        ? this.armazenamento.urlLeitura(p.fotoUrl, new Date(), 6 * 3600)
        : undefined,
    };
  }
}
