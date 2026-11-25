import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  Armazenamento,
  VALIDADE_URL_SEGUNDOS,
} from '../../../compartilhado/arquivos/armazenamento';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { nomeSeguro } from '../../saude/dominio/documento';
import { memorialHabilitado, problemaNoItem } from '../dominio/memorial';
import type { TipoItemMemorial } from '../dominio/memorial';
import { PoliticaAcessoPet } from './politica-acesso-pet';

export interface ItemDoMemorial {
  id: string;
  tipo: TipoItemMemorial;
  conteudo?: string;
  /** Foto: URL assinada de leitura, válida por 5 minutos. */
  urlFoto?: string;
  dataRegistro: string;
}

export interface MemorialDoPet {
  petId: string;
  nome: string;
  mensagem?: string;
  publico: boolean;
  itens: ItemDoMemorial[];
}

/** Falecimento e memorial do pet (UC-15, RN19). */
@Injectable()
export class MemorialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly politica: PoliticaAcessoPet,
    private readonly armazenamento: Armazenamento,
  ) {}

  /**
   * Registra o falecimento: o pet fica FALECIDO, os remédios em uso terminam e os lembretes
   * pendentes do pet são cancelados. Só o responsável principal.
   */
  async registrarFalecimento(
    usuario: UsuarioAutenticado,
    petId: string,
  ): Promise<void> {
    await this.garantir(usuario, petId, true);
    const pet = await this.prisma.pet.findUniqueOrThrow({
      where: { id: petId },
    });
    if (pet.status === 'FALECIDO') return;
    const [registros, tratamentos, eventos, planos, agendamentos] =
      await Promise.all([
        this.prisma.registroClinico.findMany({
          where: { petId },
          select: { id: true },
        }),
        this.prisma.tratamentoMedicamentoso.findMany({
          where: { registroClinico: { petId } },
          select: { id: true },
        }),
        this.prisma.eventoCalendario.findMany({
          where: { petId },
          select: { id: true },
        }),
        this.prisma.planoAlimentar.findMany({
          where: { petId },
          select: { id: true },
        }),
        this.prisma.agendamento.findMany({
          where: { petId },
          select: { id: true },
        }),
      ]);
    const origens = [
      ...registros,
      ...tratamentos,
      ...eventos,
      ...planos,
      ...agendamentos,
    ].map((o) => o.id);
    await this.prisma.$transaction([
      this.prisma.pet.update({
        where: { id: petId },
        data: { status: 'FALECIDO' },
      }),
      this.prisma.tratamentoMedicamentoso.updateMany({
        where: { registroClinico: { petId }, status: 'ATIVO' },
        data: { status: 'FINALIZADO' },
      }),
      this.prisma.notificacao.updateMany({
        where: { origemId: { in: origens }, status: 'AGENDADA' },
        data: { status: 'CANCELADA' },
      }),
    ]);
  }

  async consultar(
    usuario: UsuarioAutenticado,
    petId: string,
  ): Promise<MemorialDoPet> {
    await this.garantir(usuario, petId, false);
    const pet = await this.prisma.pet.findUniqueOrThrow({
      where: { id: petId },
      include: {
        memorial: {
          include: { itemMemorial: { orderBy: { dataRegistro: 'asc' } } },
        },
      },
    });
    const agora = new Date();
    return {
      petId,
      nome: pet.nome,
      mensagem: pet.memorial?.mensagem || undefined,
      publico: pet.memorial?.publico ?? false,
      itens: (pet.memorial?.itemMemorial ?? []).map((i) => ({
        id: i.id,
        tipo: i.tipo,
        conteudo: i.conteudo ?? undefined,
        urlFoto: i.arquivoUrl
          ? this.armazenamento.urlLeitura(i.arquivoUrl, agora)
          : undefined,
        dataRegistro: i.dataRegistro.toISOString(),
      })),
    };
  }

  /** CT-15-01 e CT-15-02: a mensagem do memorial, só para pet falecido. */
  async salvar(
    usuario: UsuarioAutenticado,
    petId: string,
    dados: { mensagem: string; publico: boolean },
  ): Promise<MemorialDoPet> {
    await this.garantirFalecido(usuario, petId);
    await this.prisma.memorial.upsert({
      where: { petId },
      create: {
        petId,
        mensagem: dados.mensagem.trim(),
        publico: dados.publico,
        dataCriacao: new Date(),
      },
      update: { mensagem: dados.mensagem.trim(), publico: dados.publico },
    });
    return this.consultar(usuario, petId);
  }

  /** Lembrança de texto, homenagem ou foto; a foto devolve a URL de envio (5 minutos). */
  async adicionarItem(
    usuario: UsuarioAutenticado,
    petId: string,
    dados: {
      tipo: TipoItemMemorial;
      conteudo?: string;
      nomeArquivo?: string;
      tamanhoBytes?: number;
    },
  ) {
    await this.garantirFalecido(usuario, petId);
    const problema = problemaNoItem(dados);
    if (problema) {
      throw Erros.dadosInvalidos(
        dados.tipo === 'FOTO' ? 'nomeArquivo' : 'conteudo',
        problema,
      );
    }
    const memorial = await this.prisma.memorial.upsert({
      where: { petId },
      create: { petId, mensagem: '', publico: false, dataCriacao: new Date() },
      update: {},
    });
    const id = randomUUID();
    const chave =
      dados.tipo === 'FOTO'
        ? `pets/${petId}/memorial/${id}/${nomeSeguro(dados.nomeArquivo!)}`
        : null;
    const agora = new Date();
    await this.prisma.itemMemorial.create({
      data: {
        id,
        memorialId: memorial.id,
        tipo: dados.tipo,
        conteudo: dados.tipo === 'FOTO' ? null : dados.conteudo!.trim(),
        arquivoUrl: chave,
        dataRegistro: agora,
      },
    });
    return {
      itemId: id,
      ...(chave
        ? {
            urlEnvio: this.armazenamento.urlEnvio(chave, agora),
            expiraEm: new Date(
              agora.getTime() + VALIDADE_URL_SEGUNDOS * 1000,
            ).toISOString(),
          }
        : {}),
    };
  }

  async removerItem(
    usuario: UsuarioAutenticado,
    itemId: string,
  ): Promise<void> {
    const item = await this.prisma.itemMemorial.findUnique({
      where: { id: itemId },
      include: { memorial: { select: { petId: true } } },
    });
    if (!item) throw Erros.naoEncontrado('Lembrança não encontrada');
    await this.garantir(usuario, item.memorial.petId, false);
    await this.prisma.itemMemorial.delete({ where: { id: itemId } });
  }

  private async garantir(
    usuario: UsuarioAutenticado,
    petId: string,
    principal: boolean,
  ) {
    const nivel = await this.politica.nivel(usuario, petId);
    const ok = principal
      ? nivel === 'RESPONSAVEL_PRINCIPAL'
      : nivel === 'RESPONSAVEL_PRINCIPAL' || nivel === 'RESPONSAVEL';
    if (!ok) {
      if (nivel === 'RESPONSAVEL') {
        throw Erros.semPermissao(
          'Só o responsável principal registra o falecimento.',
        );
      }
      throw Erros.naoEncontrado('Pet não encontrado');
    }
  }

  private async garantirFalecido(usuario: UsuarioAutenticado, petId: string) {
    await this.garantir(usuario, petId, false);
    const pet = await this.prisma.pet.findUniqueOrThrow({
      where: { id: petId },
    });
    if (!memorialHabilitado(pet.status)) {
      throw Erros.conflito(
        'RN19_MEMORIAL_BLOQUEADO',
        'O memorial fica disponível só para pets com o falecimento registrado.',
      );
    }
  }
}
