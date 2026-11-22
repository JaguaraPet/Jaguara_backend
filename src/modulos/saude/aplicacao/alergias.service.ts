import { Injectable } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { hojeBrasilia } from '../../notificacao/dominio/lembretes';
import { ordenarAlergias } from '../dominio/alergia';
import type { Gravidade, TipoAlergia } from '../dominio/alergia';
import { PoliticaSaude } from './politica-saude';

export interface Alergia {
  id: string;
  tipo: TipoAlergia;
  descricao: string;
  gravidade: Gravidade;
  dataIdentificacao?: string;
  observacoes?: string;
  /** Alergia grave aparece em destaque no perfil do pet (CT-37-01). */
  destaque: boolean;
}

interface Dados {
  tipo: TipoAlergia;
  descricao: string;
  gravidade: Gravidade;
  dataIdentificacao?: string;
  observacoes?: string;
}

/** Alergias e restrições do pet (UC-37), com o escopo ALERGIAS para empresas (RN15, RN30). */
@Injectable()
export class AlergiasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly politica: PoliticaSaude,
  ) {}

  async listar(usuario: UsuarioAutenticado, petId: string): Promise<Alergia[]> {
    await this.politica.garantir(usuario, petId, 'ALERGIAS', 'ler');
    const lista = await this.prisma.alergiaRestricao.findMany({
      where: { petId },
    });
    return ordenarAlergias(lista).map((a) => this.resposta(a));
  }

  async registrar(
    usuario: UsuarioAutenticado,
    petId: string,
    dados: Dados,
  ): Promise<Alergia> {
    await this.politica.garantir(usuario, petId, 'ALERGIAS', 'editar');
    this.validarData(dados.dataIdentificacao);
    const criada = await this.prisma.alergiaRestricao.create({
      data: {
        petId,
        tipo: dados.tipo,
        descricao: dados.descricao.trim(),
        gravidade: dados.gravidade,
        dataIdentificacao: dados.dataIdentificacao
          ? new Date(dados.dataIdentificacao)
          : null,
        observacoes: dados.observacoes?.trim() || null,
      },
    });
    return this.resposta(criada);
  }

  async alterar(
    usuario: UsuarioAutenticado,
    alergiaId: string,
    dados: Partial<Dados>,
  ): Promise<Alergia> {
    const atual = await this.buscar(alergiaId);
    await this.politica.garantir(usuario, atual.petId, 'ALERGIAS', 'editar');
    this.validarData(dados.dataIdentificacao);
    const alterada = await this.prisma.alergiaRestricao.update({
      where: { id: alergiaId },
      data: {
        tipo: dados.tipo,
        descricao: dados.descricao?.trim(),
        gravidade: dados.gravidade,
        dataIdentificacao: dados.dataIdentificacao
          ? new Date(dados.dataIdentificacao)
          : undefined,
        observacoes: dados.observacoes?.trim(),
      },
    });
    return this.resposta(alterada);
  }

  /** CT-37-02: excluir é edição clínica; sem permissão, a operação é negada (RN30). */
  async excluir(usuario: UsuarioAutenticado, alergiaId: string): Promise<void> {
    const atual = await this.buscar(alergiaId);
    await this.politica.garantir(usuario, atual.petId, 'ALERGIAS', 'editar');
    await this.prisma.alergiaRestricao.delete({ where: { id: alergiaId } });
  }

  private validarData(data?: string) {
    if (data && data > hojeBrasilia()) {
      throw Erros.dadosInvalidos(
        'dataIdentificacao',
        'A data de identificação não pode ser futura.',
      );
    }
  }

  private async buscar(alergiaId: string) {
    const alergia = await this.prisma.alergiaRestricao.findUnique({
      where: { id: alergiaId },
    });
    if (!alergia) throw Erros.naoEncontrado('Alergia não encontrada');
    return alergia;
  }

  private resposta(a: {
    id: string;
    tipo: TipoAlergia;
    descricao: string;
    gravidade: Gravidade;
    dataIdentificacao: Date | null;
    observacoes: string | null;
  }): Alergia {
    return {
      id: a.id,
      tipo: a.tipo,
      descricao: a.descricao,
      gravidade: a.gravidade,
      dataIdentificacao: a.dataIdentificacao?.toISOString().slice(0, 10),
      observacoes: a.observacoes ?? undefined,
      destaque: a.gravidade === 'GRAVE',
    };
  }
}
