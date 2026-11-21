import { Injectable } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { AgendaNotificacoesService } from '../../notificacao/aplicacao/agenda-notificacoes.service';
import {
  hojeBrasilia,
  horariosDasDoses,
} from '../../notificacao/dominio/lembretes';
import { validarTratamento } from '../dominio/tratamento';
import { PoliticaSaude } from './politica-saude';

export type StatusTratamento = 'ATIVO' | 'FINALIZADO' | 'SUSPENSO';

export interface Tratamento {
  id: string;
  medicamento: string;
  dosagem: string;
  viaAdministracao: string;
  intervaloHoras: number;
  dataInicio: string;
  dataFim?: string;
  status: StatusTratamento;
  observacoes?: string;
  lembretesAgendados?: number;
}

const dia = (d: Date) => d.toISOString().slice(0, 10);

/** Tratamentos medicamentosos com lembretes automáticos (UC-14, RN18). */
@Injectable()
export class TratamentosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly politica: PoliticaSaude,
    private readonly agenda: AgendaNotificacoesService,
  ) {}

  async listar(
    usuario: UsuarioAutenticado,
    petId: string,
  ): Promise<Tratamento[]> {
    await this.politica.garantir(usuario, petId, 'MEDICAMENTOS', 'ler');
    const tratamentos = await this.prisma.tratamentoMedicamentoso.findMany({
      where: { registroClinico: { petId, valido: true } },
      include: { registroClinico: true },
      orderBy: { dataInicio: 'desc' },
    });
    return tratamentos.map((t) => this.resposta(t));
  }

  /** CT-14-01: registra e agenda um lembrete por dose para cada responsável do pet. */
  async cadastrar(
    usuario: UsuarioAutenticado,
    petId: string,
    dados: {
      medicamento: string;
      dosagem: string;
      viaAdministracao: string;
      intervaloHoras: number;
      dataInicio: string;
      dataFim?: string;
      horaPrimeiraDose?: string;
      observacoes?: string;
    },
  ): Promise<Tratamento> {
    await this.politica.garantir(usuario, petId, 'MEDICAMENTOS', 'editar');
    const erro = validarTratamento(dados, hojeBrasilia());
    if (erro) throw Erros.dadosInvalidos(erro.campo, erro.mensagem);

    const criado = await this.prisma.registroClinico.create({
      data: {
        petId,
        registradoPorId: usuario.sub,
        dataRegistro: new Date(),
        observacoes: dados.observacoes?.trim() || null,
        valido: true,
        tratamentoMedicamentoso: {
          create: {
            medicamento: dados.medicamento.trim(),
            dosagem: dados.dosagem.trim(),
            viaAdministracao: dados.viaAdministracao.trim(),
            intervaloHoras: dados.intervaloHoras,
            dataInicio: new Date(dados.dataInicio),
            dataFim: dados.dataFim ? new Date(dados.dataFim) : null,
            status: 'ATIVO',
          },
        },
      },
      include: {
        tratamentoMedicamentoso: true,
        pet: { select: { nome: true } },
      },
    });

    const doses = horariosDasDoses({ ...dados, agora: new Date() });
    const destinatarios = await this.agenda.responsaveisDoPet(petId);
    const medicamento = dados.medicamento.trim();
    const agendados = await this.agenda.agendar(
      doses.flatMap((quando) =>
        destinatarios.map((destinatarioId) => ({
          destinatarioId,
          titulo: `Hora do remédio de ${criado.pet.nome}`,
          mensagem: `${medicamento}: ${dados.dosagem.trim()} (${dados.viaAdministracao.trim()}).`,
          dataProgramada: quando,
          origemTipo: 'TRATAMENTO' as const,
          origemId: criado.id,
        })),
      ),
    );
    return {
      ...this.resposta({
        ...criado.tratamentoMedicamentoso!,
        registroClinico: criado,
      }),
      lembretesAgendados: agendados,
    };
  }

  /** CT-14-02: finaliza hoje e cancela os lembretes que ainda não saíram. */
  async finalizar(
    usuario: UsuarioAutenticado,
    tratamentoId: string,
  ): Promise<void> {
    const tratamento = await this.prisma.tratamentoMedicamentoso.findUnique({
      where: { id: tratamentoId },
      include: { registroClinico: { select: { petId: true } } },
    });
    if (!tratamento) throw Erros.naoEncontrado('Tratamento não encontrado');
    await this.politica.garantir(
      usuario,
      tratamento.registroClinico.petId,
      'MEDICAMENTOS',
      'editar',
    );
    if (tratamento.status !== 'FINALIZADO') {
      await this.prisma.tratamentoMedicamentoso.update({
        where: { id: tratamentoId },
        data: { status: 'FINALIZADO', dataFim: new Date(hojeBrasilia()) },
      });
    }
    await this.agenda.cancelar('TRATAMENTO', tratamentoId);
  }

  private resposta(t: {
    id: string;
    medicamento: string;
    dosagem: string;
    viaAdministracao: string;
    intervaloHoras: number;
    dataInicio: Date;
    dataFim: Date | null;
    status: StatusTratamento;
    registroClinico: { observacoes: string | null };
  }): Tratamento {
    return {
      id: t.id,
      medicamento: t.medicamento,
      dosagem: t.dosagem,
      viaAdministracao: t.viaAdministracao,
      intervaloHoras: t.intervaloHoras,
      dataInicio: dia(t.dataInicio),
      dataFim: t.dataFim ? dia(t.dataFim) : undefined,
      status: t.status,
      observacoes: t.registroClinico.observacoes ?? undefined,
    };
  }
}
