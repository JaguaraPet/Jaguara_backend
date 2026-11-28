import { Injectable } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { AgendaNotificacoesService } from '../../notificacao/aplicacao/agenda-notificacoes.service';
import {
  hojeBrasilia,
  instanteBrasilia,
} from '../../notificacao/dominio/lembretes';
import { PoliticaAcessoPet } from '../../pet/aplicacao/politica-acesso-pet';
import {
  FrequenciaRotina,
  horarioValido,
  MODELOS_ROTINA,
  proximasDatas,
  TipoRotina,
} from '../dominio/rotina';

export interface DadosRotina {
  titulo: string;
  tipo: TipoRotina;
  frequencia: FrequenciaRotina;
  intervaloDias?: number | null;
  diasSemana?: number[];
  horarios?: string[];
  dataInicio?: string;
}

/** Lembretes das rotinas: os próximos 30 dias, renovados quando a rotina muda. */
const JANELA_LEMBRETES_DIAS = 30;

const dia = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Criador de rotinas do tutor (passeio, banho, antipulgas...). Cada rotina gera os itens do dia
 * na tela Hoje e os lembretes para todos os responsáveis do pet. O app não recomenda frequência:
 * os modelos são atalhos editáveis.
 */
@Injectable()
export class RotinasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly politicaPet: PoliticaAcessoPet,
    private readonly agenda: AgendaNotificacoesService,
  ) {}

  modelos() {
    return MODELOS_ROTINA;
  }

  async listar(usuario: UsuarioAutenticado, petId: string) {
    await this.garantirResponsavel(usuario, petId);
    const rotinas = await this.prisma.rotina.findMany({
      where: { petId, ativa: true },
      orderBy: { criadoEm: 'asc' },
    });
    return rotinas.map((r) => this.resposta(r));
  }

  async criar(usuario: UsuarioAutenticado, petId: string, dados: DadosRotina) {
    await this.garantirResponsavel(usuario, petId);
    const regra = this.validar(dados);
    const criada = await this.prisma.rotina.create({
      data: {
        petId,
        titulo: dados.titulo.trim(),
        tipo: dados.tipo,
        ...regra,
        criadoPorId: usuario.sub,
      },
    });
    await this.programarLembretes(criada.id);
    return this.resposta(criada);
  }

  async atualizar(
    usuario: UsuarioAutenticado,
    rotinaId: string,
    dados: DadosRotina,
  ) {
    const atual = await this.buscar(usuario, rotinaId);
    const regra = this.validar({
      ...dados,
      dataInicio: dados.dataInicio ?? dia(atual.dataInicio),
    });
    const alterada = await this.prisma.rotina.update({
      where: { id: rotinaId },
      data: { titulo: dados.titulo.trim(), tipo: dados.tipo, ...regra },
    });
    await this.programarLembretes(rotinaId);
    return this.resposta(alterada);
  }

  async desativar(
    usuario: UsuarioAutenticado,
    rotinaId: string,
  ): Promise<void> {
    await this.buscar(usuario, rotinaId);
    await this.prisma.rotina.update({
      where: { id: rotinaId },
      data: { ativa: false },
    });
    await this.agenda.cancelar('ROTINA', rotinaId);
  }

  /** "Feito": registra quem fez, uma vez por dia e horário. */
  async marcar(
    usuario: UsuarioAutenticado,
    rotinaId: string,
    dados: { data?: string; horario?: string },
  ) {
    await this.buscar(usuario, rotinaId);
    const data = dados.data ?? hojeBrasilia();
    const horario = dados.horario ?? '';
    if (horario && !horarioValido(horario)) {
      throw Erros.dadosInvalidos('horario', 'Use o horário no formato HH:MM.');
    }
    const registro = await this.prisma.registroRotina.upsert({
      where: {
        rotinaId_data_horario: { rotinaId, data: new Date(data), horario },
      },
      create: {
        rotinaId,
        data: new Date(data),
        horario,
        feitoPorId: usuario.sub,
      },
      update: {},
    });
    return {
      rotinaId,
      data,
      horario: horario || null,
      feitoEm: registro.feitoEm.toISOString(),
    };
  }

  /** Desfaz um "feito" marcado por engano. */
  async desmarcar(
    usuario: UsuarioAutenticado,
    rotinaId: string,
    dados: { data: string; horario?: string },
  ): Promise<void> {
    await this.buscar(usuario, rotinaId);
    await this.prisma.registroRotina.deleteMany({
      where: {
        rotinaId,
        data: new Date(dados.data),
        horario: dados.horario ?? '',
      },
    });
  }

  private validar(dados: DadosRotina) {
    if (!dados.titulo?.trim())
      throw Erros.dadosInvalidos('titulo', 'Dê um nome à rotina.');
    const horarios = [...new Set(dados.horarios ?? [])].sort();
    if (horarios.length > 6 || horarios.some((h) => !horarioValido(h))) {
      throw Erros.dadosInvalidos(
        'horarios',
        'Use até 6 horários no formato HH:MM.',
      );
    }
    const diasSemana = [...new Set(dados.diasSemana ?? [])]
      .filter((d) => d >= 0 && d <= 6)
      .sort();
    if (dados.frequencia === 'SEMANAL' && diasSemana.length === 0) {
      throw Erros.dadosInvalidos(
        'diasSemana',
        'Escolha ao menos um dia da semana.',
      );
    }
    const intervalo = dados.intervaloDias ?? null;
    if (
      dados.frequencia === 'INTERVALO_DIAS' &&
      (!intervalo || intervalo < 1 || intervalo > 365)
    ) {
      throw Erros.dadosInvalidos(
        'intervaloDias',
        'Informe de quantos em quantos dias (1 a 365).',
      );
    }
    const dataInicio = dados.dataInicio ?? hojeBrasilia();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicio)) {
      throw Erros.dadosInvalidos(
        'dataInicio',
        'Use a data no formato AAAA-MM-DD.',
      );
    }
    return {
      frequencia: dados.frequencia,
      intervaloDias: dados.frequencia === 'INTERVALO_DIAS' ? intervalo : null,
      diasSemana: dados.frequencia === 'SEMANAL' ? diasSemana : [],
      horarios,
      dataInicio: new Date(dataInicio),
    };
  }

  /** Reprograma os lembretes dos próximos 30 dias para os responsáveis do pet. */
  private async programarLembretes(rotinaId: string): Promise<void> {
    await this.agenda.cancelar('ROTINA', rotinaId);
    const r = await this.prisma.rotina.findUnique({
      where: { id: rotinaId },
      include: { pet: { select: { nome: true } } },
    });
    if (!r || !r.ativa) return;
    const destinatarios = await this.agenda.responsaveisDoPet(r.petId);
    const datas = proximasDatas(
      {
        frequencia: r.frequencia,
        intervaloDias: r.intervaloDias,
        diasSemana: r.diasSemana,
        dataInicio: dia(r.dataInicio),
      },
      hojeBrasilia(),
      JANELA_LEMBRETES_DIAS,
    );
    // Sem horário, o lembrete sai às 9h do dia.
    const horarios = r.horarios.length ? r.horarios : ['09:00'];
    await this.agenda.agendar(
      datas.flatMap((data) =>
        horarios.flatMap((horario) =>
          destinatarios.map((destinatarioId) => ({
            destinatarioId,
            titulo: `${r.titulo} do ${r.pet.nome}`,
            mensagem: 'Marque como feito no app para a família saber.',
            dataReferencia: instanteBrasilia(data, horario),
            tipoEvento: 'COMPROMISSO' as const,
            origemTipo: 'ROTINA' as const,
            origemId: r.id,
            antecedenciaMinutos: 0,
          })),
        ),
      ),
    );
  }

  private async buscar(usuario: UsuarioAutenticado, rotinaId: string) {
    const rotina = await this.prisma.rotina.findUnique({
      where: { id: rotinaId },
    });
    if (!rotina || !rotina.ativa)
      throw Erros.naoEncontrado('Rotina não encontrada');
    await this.garantirResponsavel(usuario, rotina.petId);
    return rotina;
  }

  private async garantirResponsavel(
    usuario: UsuarioAutenticado,
    petId: string,
  ) {
    const nivel = await this.politicaPet.nivel(usuario, petId);
    if (nivel !== 'RESPONSAVEL_PRINCIPAL' && nivel !== 'RESPONSAVEL') {
      throw Erros.naoEncontrado('Pet não encontrado');
    }
  }

  private resposta(r: {
    id: string;
    petId: string;
    titulo: string;
    tipo: TipoRotina;
    frequencia: FrequenciaRotina;
    intervaloDias: number | null;
    diasSemana: number[];
    horarios: string[];
    dataInicio: Date;
  }) {
    return {
      id: r.id,
      petId: r.petId,
      titulo: r.titulo,
      tipo: r.tipo,
      frequencia: r.frequencia,
      intervaloDias: r.intervaloDias,
      diasSemana: r.diasSemana,
      horarios: r.horarios,
      dataInicio: dia(r.dataInicio),
    };
  }
}
