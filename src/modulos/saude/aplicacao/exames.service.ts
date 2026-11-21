import { Injectable } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { hojeBrasilia } from '../../notificacao/dominio/lembretes';
import { PoliticaSaude } from './politica-saude';

export interface Exame {
  id: string;
  tipoExame: string;
  dataRealizacao: string;
  laboratorio?: string;
  resultado?: string;
  documentoId?: string;
  temArquivo: boolean;
  observacoes?: string;
}

const dia = (d: Date) => d.toISOString().slice(0, 10);

/** Exames do pet (UC-36): registro e histórico clínico. */
@Injectable()
export class ExamesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly politica: PoliticaSaude,
  ) {}

  /** Histórico do mais recente para o mais antigo, só registros válidos. */
  async listar(usuario: UsuarioAutenticado, petId: string): Promise<Exame[]> {
    await this.politica.garantir(usuario, petId, 'EXAMES', 'ler');
    const exames = await this.prisma.exame.findMany({
      where: { registroClinico: { petId, valido: true } },
      include: { registroClinico: true },
      orderBy: { dataRealizacao: 'desc' },
    });
    return exames.map((e) => this.resposta(e));
  }

  /**
   * CT-36-01 e CT-36-02: registra o exame com o laudo opcional, um documento do próprio pet.
   * A empresa só registra com os escopos EXAMES e EDICAO_CLINICA (RN15, RN30).
   */
  async registrar(
    usuario: UsuarioAutenticado,
    petId: string,
    dados: {
      tipoExame: string;
      dataRealizacao: string;
      laboratorio?: string;
      resultado?: string;
      documentoId?: string;
      observacoes?: string;
    },
  ): Promise<Exame> {
    await this.politica.garantir(usuario, petId, 'EXAMES', 'editar');
    if (dados.dataRealizacao > hojeBrasilia()) {
      throw Erros.dadosInvalidos(
        'dataRealizacao',
        'A data do exame não pode ser futura.',
      );
    }
    let arquivo: { id: string; arquivoUrl: string } | null = null;
    if (dados.documentoId) {
      arquivo = await this.prisma.documentoPet.findFirst({
        where: { id: dados.documentoId, petId },
        select: { id: true, arquivoUrl: true },
      });
      if (!arquivo) {
        throw Erros.dadosInvalidos(
          'documentoId',
          'Escolha um documento deste pet como laudo.',
        );
      }
    }
    const criado = await this.prisma.registroClinico.create({
      data: {
        petId,
        registradoPorId: usuario.sub,
        dataRegistro: new Date(),
        observacoes: dados.observacoes?.trim() || null,
        valido: true,
        exame: {
          create: {
            tipoExame: dados.tipoExame.trim(),
            dataRealizacao: new Date(dados.dataRealizacao),
            laboratorio: dados.laboratorio?.trim() || null,
            resultado: dados.resultado?.trim() || null,
            arquivoResultadoUrl: arquivo?.arquivoUrl ?? null,
          },
        },
      },
      include: { exame: true },
    });
    return {
      ...this.resposta({ ...criado.exame!, registroClinico: criado }),
      documentoId: arquivo?.id,
    };
  }

  private resposta(e: {
    id: string;
    tipoExame: string;
    dataRealizacao: Date;
    laboratorio: string | null;
    resultado: string | null;
    arquivoResultadoUrl: string | null;
    registroClinico: { observacoes: string | null };
  }): Exame {
    return {
      id: e.id,
      tipoExame: e.tipoExame,
      dataRealizacao: dia(e.dataRealizacao),
      laboratorio: e.laboratorio ?? undefined,
      resultado: e.resultado ?? undefined,
      // O endereço do arquivo não sai da API: o download usa URL assinada (ARQ-03, seção 3.6).
      temArquivo: !!e.arquivoResultadoUrl,
      observacoes: e.registroClinico.observacoes ?? undefined,
    };
  }
}
