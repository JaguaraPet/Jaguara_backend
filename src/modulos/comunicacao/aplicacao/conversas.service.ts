import { Injectable } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { PoliticaAcessoPet } from '../../pet/aplicacao/politica-acesso-pet';
import {
  assinaturaVigente,
  normalizarConteudo,
  participa,
  podeIniciar,
  salasDaConversa,
} from '../dominio/conversa';
import type {
  Participante,
  StatusConversa,
  TipoConversa,
} from '../dominio/conversa';
import { CanalTempoReal } from './canal-tempo-real';

export interface Conversa {
  id: string;
  tipo: TipoConversa;
  empresaId?: string;
  petId?: string;
  status: StatusConversa;
}

export interface Mensagem {
  id: string;
  conversaId: string;
  conteudo: string;
  dataHoraEnvio: string;
  remetenteId: string | null;
  lida: boolean;
}

/** Evento do Socket.IO com cada mensagem nova (ADR-011). */
export const EVENTO_MENSAGEM_NOVA = 'mensagem:nova';

const PAGINA_MENSAGENS = 50;

/** Chat entre tutor e empresa e com o assistente virtual (UC-43). */
@Injectable()
export class ConversasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly politicaPet: PoliticaAcessoPet,
    private readonly canal: CanalTempoReal,
  ) {}

  /** O tutor vê as conversas dele; a empresa vê as conversas abertas com ela. */
  async listar(usuario: UsuarioAutenticado): Promise<Conversa[]> {
    const where =
      usuario.tipo === 'TUTOR'
        ? { tutorId: usuario.sub }
        : usuario.empresaId
          ? { empresaId: usuario.empresaId, tipo: 'EMPRESA' as const }
          : null;
    if (!where) throw Erros.semPermissao();
    const conversas = await this.prisma.conversa.findMany({
      where,
      orderBy: { atualizadoEm: 'desc' },
    });
    return conversas.map((c) => this.conversa(c));
  }

  /** CT-43-01 e CT-43-02: abre (ou reaproveita) a conversa aberta com a empresa ou o assistente. */
  async iniciar(
    usuario: UsuarioAutenticado,
    pedido: { tipo: TipoConversa; empresaId?: string; petId?: string },
  ): Promise<Conversa> {
    const quem = this.participante(usuario);
    const empresaId = pedido.tipo === 'EMPRESA' ? pedido.empresaId : undefined;
    const recusa = podeIniciar(quem, pedido, {
      temVinculoEmpresa: empresaId
        ? await this.temVinculo(usuario.sub, empresaId)
        : false,
      temPantera:
        pedido.tipo === 'ASSISTENTE_VIRTUAL'
          ? await this.temPantera(usuario.sub)
          : false,
    });
    switch (recusa) {
      case 'SO_TUTOR_INICIA':
        throw Erros.semPermissao('Só o tutor inicia conversas.');
      case 'EMPRESA_OBRIGATORIA':
        throw Erros.dadosInvalidos('empresaId', 'Escolha a empresa.');
      case 'SEM_VINCULO_EMPRESA':
        throw Erros.semPermissao(
          'Você conversa com empresas em que é cliente ou tem agendamento.',
        );
      case 'SEM_PANTERA':
        throw Erros.assinaturaNecessaria();
    }
    if (pedido.petId) {
      const nivel = await this.politicaPet.nivel(usuario, pedido.petId);
      if (nivel !== 'RESPONSAVEL_PRINCIPAL' && nivel !== 'RESPONSAVEL')
        throw Erros.semPermissao('Escolha um pet seu.');
    }

    const aberta = await this.prisma.conversa.findFirst({
      where: {
        tutorId: usuario.sub,
        tipo: pedido.tipo,
        empresaId: empresaId ?? null,
        petId: pedido.petId ?? null,
        status: 'ABERTA',
      },
    });
    if (aberta) return this.conversa(aberta);
    const criada = await this.prisma.conversa.create({
      data: {
        tipo: pedido.tipo,
        tutorId: usuario.sub,
        empresaId,
        petId: pedido.petId,
        status: 'ABERTA',
        dataInicio: new Date(),
      },
    });
    return this.conversa(criada);
  }

  /** Histórico do mais novo para o mais antigo; marca como lidas as mensagens dos outros. */
  async mensagens(
    usuario: UsuarioAutenticado,
    conversaId: string,
    antes?: string,
  ): Promise<Mensagem[]> {
    await this.buscar(usuario, conversaId);
    const lista = await this.prisma.mensagem.findMany({
      where: {
        conversaId,
        ...(antes ? { dataHoraEnvio: { lt: new Date(antes) } } : {}),
      },
      orderBy: { dataHoraEnvio: 'desc' },
      take: PAGINA_MENSAGENS,
    });
    await this.prisma.mensagem.updateMany({
      where: {
        conversaId,
        lida: false,
        OR: [{ remetenteId: null }, { remetenteId: { not: usuario.sub } }],
      },
      data: { lida: true },
    });
    return lista.map((m) => this.mensagem(m));
  }

  /** Grava a mensagem e avisa as salas do tutor e da empresa em tempo real (RNF08). */
  async enviar(
    usuario: UsuarioAutenticado,
    conversaId: string,
    conteudo: unknown,
  ): Promise<Mensagem> {
    const conversa = await this.buscar(usuario, conversaId);
    if (conversa.status !== 'ABERTA') {
      throw Erros.conflito(
        'CONVERSA_ENCERRADA',
        'Esta conversa foi encerrada.',
      );
    }
    const texto = normalizarConteudo(conteudo);
    if (!texto.ok) throw Erros.dadosInvalidos('conteudo', texto.motivo);
    return this.registrar(conversa, texto.texto, usuario.sub);
  }

  /** UC-43, passos 6 e 7: o tutor encerra e a conversa fica arquivada. */
  async encerrar(usuario: UsuarioAutenticado, conversaId: string) {
    const conversa = await this.buscar(usuario, conversaId);
    if (usuario.tipo !== 'TUTOR')
      throw Erros.semPermissao('Só o tutor encerra a conversa.');
    if (conversa.status === 'ENCERRADA') return;
    await this.prisma.conversa.update({
      where: { id: conversaId },
      data: { status: 'ENCERRADA' },
    });
  }

  /** Grava e distribui uma mensagem; remetente nulo é o assistente virtual. */
  async registrar(
    conversa: {
      id: string;
      tipo: TipoConversa;
      tutorId: string;
      empresaId: string | null;
    },
    texto: string,
    remetenteId: string | null,
  ): Promise<Mensagem> {
    const [criada] = await this.prisma.$transaction([
      this.prisma.mensagem.create({
        data: {
          conversaId: conversa.id,
          conteudo: texto,
          remetenteId,
          dataHoraEnvio: new Date(),
          lida: false,
        },
      }),
      this.prisma.conversa.update({
        where: { id: conversa.id },
        data: { atualizadoEm: new Date() },
      }),
    ]);
    const mensagem = this.mensagem(criada);
    this.canal.emitir(
      salasDaConversa(conversa),
      EVENTO_MENSAGEM_NOVA,
      mensagem,
    );
    return mensagem;
  }

  async buscar(usuario: UsuarioAutenticado, conversaId: string) {
    const conversa = await this.prisma.conversa.findUnique({
      where: { id: conversaId },
    });
    if (!conversa || !participa(this.participante(usuario), conversa)) {
      throw Erros.naoEncontrado('Conversa não encontrada');
    }
    return conversa;
  }

  private participante(usuario: UsuarioAutenticado): Participante {
    return {
      id: usuario.sub,
      tipo: usuario.tipo,
      empresaId: usuario.empresaId,
    };
  }

  /** Vínculo do CT-43-01: o tutor é cliente da empresa ou tem agendamento com ela. */
  private async temVinculo(tutorId: string, empresaId: string) {
    const cliente = await this.prisma.cliente.count({
      where: { tutorId, empresaId, ativo: true },
    });
    if (cliente > 0) return true;
    const agendamentos = await this.prisma.agendamento.count({
      where: {
        servico: { empresaId },
        pet: { responsavelPet: { some: { tutorId, ativo: true } } },
      },
    });
    return agendamentos > 0;
  }

  private async temPantera(tutorId: string) {
    const assinaturas = await this.prisma.assinatura.findMany({
      where: { tutorId, plano: 'PANTERA', status: 'ATIVA' },
    });
    const hoje = new Date();
    return assinaturas.some((a) => assinaturaVigente(a, hoje));
  }

  private conversa(c: {
    id: string;
    tipo: TipoConversa;
    empresaId: string | null;
    petId: string | null;
    status: StatusConversa;
  }): Conversa {
    return {
      id: c.id,
      tipo: c.tipo,
      empresaId: c.empresaId ?? undefined,
      petId: c.petId ?? undefined,
      status: c.status,
    };
  }

  private mensagem(m: {
    id: string;
    conversaId: string;
    conteudo: string;
    dataHoraEnvio: Date;
    remetenteId: string | null;
    lida: boolean;
  }): Mensagem {
    return {
      id: m.id,
      conversaId: m.conversaId,
      conteudo: m.conteudo,
      dataHoraEnvio: m.dataHoraEnvio.toISOString(),
      remetenteId: m.remetenteId,
      lida: m.lida,
    };
  }
}
