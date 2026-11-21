import { Injectable } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { AgendaNotificacoesService } from '../../notificacao/aplicacao/agenda-notificacoes.service';
import {
  dataBrasileira,
  hojeBrasilia,
  instanteBrasilia,
} from '../../notificacao/dominio/lembretes';
import { validarVacinacao } from '../dominio/vacinacao';
import { PoliticaSaude } from './politica-saude';

export interface Vacinacao {
  id: string;
  nomeVacina: string;
  fabricante?: string;
  lote?: string;
  dataAplicacao: string;
  dataProximaDose?: string;
  responsavelAplicacao: string;
  observacoes?: string;
  valido: boolean;
}

const dia = (d: Date) => d.toISOString().slice(0, 10);

/** Visualizar (UC-12) e cadastrar (UC-13) vacinação. */
@Injectable()
export class VacinacoesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly politica: PoliticaSaude,
    private readonly agenda: AgendaNotificacoesService,
  ) {}

  /** CT-12-01 e CT-12-02: só registros válidos, em ordem de aplicação (RN16). */
  async listar(
    usuario: UsuarioAutenticado,
    petId: string,
  ): Promise<Vacinacao[]> {
    await this.politica.garantir(usuario, petId, 'VACINAS', 'ler');
    const registros = await this.prisma.vacinacao.findMany({
      where: { registroClinico: { petId, valido: true } },
      include: { registroClinico: true },
      orderBy: { dataAplicacao: 'asc' },
    });
    return registros.map((r) => this.resposta(r));
  }

  /** CT-13-01: registra e agenda o lembrete da próxima dose para os responsáveis. */
  async cadastrar(
    usuario: UsuarioAutenticado,
    petId: string,
    dados: {
      nomeVacina: string;
      fabricante?: string;
      lote?: string;
      dataAplicacao: string;
      dataProximaDose?: string;
      responsavelAplicacao: string;
      observacoes?: string;
    },
  ): Promise<Vacinacao> {
    await this.politica.garantir(usuario, petId, 'VACINAS', 'editar');
    const erro = validarVacinacao(dados, hojeBrasilia());
    if (erro) throw Erros.dadosInvalidos(erro.campo, erro.mensagem);

    const criado = await this.prisma.registroClinico.create({
      data: {
        petId,
        registradoPorId: usuario.sub,
        dataRegistro: new Date(),
        observacoes: dados.observacoes?.trim() || null,
        valido: true,
        vacinacao: {
          create: {
            nomeVacina: dados.nomeVacina.trim(),
            fabricante: dados.fabricante?.trim() || null,
            lote: dados.lote?.trim() || null,
            dataAplicacao: new Date(dados.dataAplicacao),
            dataProximaDose: dados.dataProximaDose
              ? new Date(dados.dataProximaDose)
              : null,
            responsavelAplicacao: dados.responsavelAplicacao.trim(),
          },
        },
      },
      include: { vacinacao: true, pet: { select: { nome: true } } },
    });

    if (dados.dataProximaDose) {
      // Referência às 9h do dia da dose; a antecedência padrão da vacina é um dia (RN37).
      const destinatarios = await this.agenda.responsaveisDoPet(petId);
      await this.agenda.agendar(
        destinatarios.map((destinatarioId) => ({
          destinatarioId,
          titulo: `Vacina de ${criado.pet.nome}`,
          mensagem: `A próxima dose de ${dados.nomeVacina.trim()} de ${criado.pet.nome} é em ${dataBrasileira(dados.dataProximaDose!)}.`,
          dataReferencia: instanteBrasilia(dados.dataProximaDose!),
          tipoEvento: 'VACINA',
          origemTipo: 'VACINACAO',
          origemId: criado.id,
        })),
      );
    }
    return this.resposta({ ...criado.vacinacao!, registroClinico: criado });
  }

  private resposta(r: {
    id: string;
    nomeVacina: string;
    fabricante: string | null;
    lote: string | null;
    dataAplicacao: Date;
    dataProximaDose: Date | null;
    responsavelAplicacao: string;
    registroClinico: { observacoes: string | null; valido: boolean };
  }): Vacinacao {
    return {
      id: r.id,
      nomeVacina: r.nomeVacina,
      fabricante: r.fabricante ?? undefined,
      lote: r.lote ?? undefined,
      dataAplicacao: dia(r.dataAplicacao),
      dataProximaDose: r.dataProximaDose ? dia(r.dataProximaDose) : undefined,
      responsavelAplicacao: r.responsavelAplicacao,
      observacoes: r.registroClinico.observacoes ?? undefined,
      valido: r.registroClinico.valido,
    };
  }
}
