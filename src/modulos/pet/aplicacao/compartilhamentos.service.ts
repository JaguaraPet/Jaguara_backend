import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import type { Ambiente } from '../../../compartilhado/config/ambiente';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { FilaEmailService } from '../../notificacao/aplicacao/fila-email.service';
import {
  ROTULO_ESCOPO,
  SECOES,
  situacao,
  validarCompartilhamento,
} from '../dominio/compartilhamento';
import type { Escopo, Secao, SituacaoLink } from '../dominio/compartilhamento';
import { idadeEmAnos } from '../dominio/pet';
import { PoliticaAcessoPet } from './politica-acesso-pet';

export interface Compartilhamento {
  id: string;
  empresaId?: string;
  destinatarioEmail?: string;
  escopos: Escopo[];
  dataExpiracao?: string;
  status: SituacaoLink;
  /** Só na criação: o link não é guardado em texto puro. */
  link?: string;
}

const dia = (d: Date) => d.toISOString().slice(0, 10);
const resumo = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/** Compartilhar o perfil do pet com empresas ou por link (UC-11, RN15). */
@Injectable()
export class CompartilhamentosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly politica: PoliticaAcessoPet,
    private readonly fila: FilaEmailService,
    private readonly config: ConfigService<Ambiente, true>,
  ) {}

  async listar(
    usuario: UsuarioAutenticado,
    petId: string,
  ): Promise<Compartilhamento[]> {
    await this.garantirResponsavel(usuario, petId);
    const lista = await this.prisma.compartilhamentoPet.findMany({
      where: { petId },
      orderBy: { dataConcessao: 'desc' },
    });
    return lista.map((c) => this.resposta(c));
  }

  /**
   * CT-11-01: libera só os escopos escolhidos. Com empresa, o acesso vale dentro do sistema;
   * com e-mail, o destinatário recebe um link de leitura sem precisar de conta.
   */
  async compartilhar(
    usuario: UsuarioAutenticado,
    petId: string,
    pedido: {
      empresaId?: string;
      destinatarioEmail?: string;
      escopos: Escopo[];
      dataExpiracao?: string;
    },
  ): Promise<Compartilhamento> {
    await this.garantirResponsavel(usuario, petId);
    const erro = validarCompartilhamento(pedido, new Date());
    if (erro) throw Erros.dadosInvalidos(erro.campo, erro.mensagem);
    if (pedido.empresaId) {
      const empresa = await this.prisma.empresaEnterprise.findUnique({
        where: { id: pedido.empresaId },
        select: { id: true },
      });
      if (!empresa)
        throw Erros.dadosInvalidos('empresaId', 'Empresa não encontrada.');
    }
    const escopos = [...new Set(pedido.escopos)];
    const token = randomBytes(32).toString('base64url');
    const criado = await this.prisma.compartilhamentoPet.create({
      data: {
        petId,
        empresaId: pedido.empresaId,
        destinatarioEmail: pedido.destinatarioEmail?.trim().toLowerCase(),
        escopos,
        token: resumo(token),
        dataConcessao: new Date(),
        dataExpiracao: pedido.dataExpiracao
          ? new Date(pedido.dataExpiracao)
          : null,
        status: 'ATIVO',
      },
      include: {
        pet: { select: { nome: true } },
      },
    });
    const link = `${this.config.get('URL_WEB', { infer: true }).split(',')[0]}/compartilhado/${token}`;
    if (criado.destinatarioEmail) {
      const tutor = await this.prisma.tutor.findUnique({
        where: { id: usuario.sub },
        select: { nome: true },
      });
      await this.fila.enviar('COMPARTILHAMENTO_PET', criado.destinatarioEmail, {
        tutor: tutor?.nome ?? 'Um tutor',
        pet: criado.pet.nome,
        secoes: escopos.map((e) => ROTULO_ESCOPO[e]).join(', '),
        link,
        validade: criado.dataExpiracao
          ? criado.dataExpiracao.toLocaleString('pt-BR', {
              timeZone: 'America/Sao_Paulo',
            })
          : null,
      });
    }
    return { ...this.resposta(criado), link };
  }

  /** O tutor revoga a qualquer momento; o acesso cai na hora (RN15). */
  async revogar(usuario: UsuarioAutenticado, compartilhamentoId: string) {
    const atual = await this.prisma.compartilhamentoPet.findUnique({
      where: { id: compartilhamentoId },
    });
    if (!atual) throw Erros.naoEncontrado('Compartilhamento não encontrado');
    await this.garantirResponsavel(usuario, atual.petId);
    if (atual.status === 'ATIVO') {
      await this.prisma.compartilhamentoPet.update({
        where: { id: compartilhamentoId },
        data: { status: 'REVOGADO' },
      });
    }
  }

  /** Página pública do link: perfil básico, se liberado, e a lista do que foi compartilhado. */
  async verPorLink(token: string) {
    const c = await this.buscarPorLink(token);
    const pet = await this.prisma.pet.findUniqueOrThrow({
      where: { id: c.petId },
      include: { raca: { include: { especie: true } } },
    });
    const basico = c.escopos.includes('PERFIL_BASICO');
    return {
      pet: {
        nome: pet.nome,
        ...(basico
          ? {
              especie: pet.raca.especie.nome,
              raca: pet.raca.nome,
              sexo: pet.sexo,
              castrado: pet.castrado,
              idadeAnos: idadeEmAnos(pet.dataNascimento, new Date()),
            }
          : {}),
      },
      escopos: c.escopos,
      secoes: (Object.keys(SECOES) as Secao[]).filter((s) =>
        c.escopos.includes(SECOES[s]),
      ),
      dataExpiracao: c.dataExpiracao?.toISOString(),
    };
  }

  /** CT-11-02: cada seção exige o seu escopo; o resto é negado. */
  async secaoPorLink(token: string, secao: Secao) {
    const c = await this.buscarPorLink(token);
    if (!c.escopos.includes(SECOES[secao])) {
      throw Erros.semPermissao('Esta informação não foi compartilhada.');
    }
    const clinico = { petId: c.petId, valido: true };
    switch (secao) {
      case 'vacinas':
        return (
          await this.prisma.vacinacao.findMany({
            where: { registroClinico: clinico },
            orderBy: { dataAplicacao: 'asc' },
          })
        ).map((v) => ({
          nomeVacina: v.nomeVacina,
          dataAplicacao: dia(v.dataAplicacao),
          dataProximaDose: v.dataProximaDose
            ? dia(v.dataProximaDose)
            : undefined,
          responsavelAplicacao: v.responsavelAplicacao,
        }));
      case 'exames':
        return (
          await this.prisma.exame.findMany({
            where: { registroClinico: clinico },
            orderBy: { dataRealizacao: 'desc' },
          })
        ).map((e) => ({
          tipoExame: e.tipoExame,
          dataRealizacao: dia(e.dataRealizacao),
          laboratorio: e.laboratorio ?? undefined,
          resultado: e.resultado ?? undefined,
        }));
      case 'medicamentos':
        return (
          await this.prisma.tratamentoMedicamentoso.findMany({
            where: { registroClinico: clinico },
            orderBy: { dataInicio: 'desc' },
          })
        ).map((t) => ({
          medicamento: t.medicamento,
          dosagem: t.dosagem,
          viaAdministracao: t.viaAdministracao,
          intervaloHoras: t.intervaloHoras,
          dataInicio: dia(t.dataInicio),
          dataFim: t.dataFim ? dia(t.dataFim) : undefined,
          status: t.status,
        }));
      case 'alergias':
        return (
          await this.prisma.alergiaRestricao.findMany({
            where: { petId: c.petId },
            orderBy: { gravidade: 'desc' },
          })
        ).map((a) => ({
          tipo: a.tipo,
          descricao: a.descricao,
          gravidade: a.gravidade,
        }));
    }
  }

  private async buscarPorLink(token: string) {
    const c = await this.prisma.compartilhamentoPet.findUnique({
      where: { token: resumo(token) },
    });
    if (!c || c.empresaId) throw Erros.linkExpirado();
    if (situacao(c, new Date()) !== 'ATIVO') throw Erros.linkExpirado();
    return c;
  }

  private async garantirResponsavel(
    usuario: UsuarioAutenticado,
    petId: string,
  ) {
    const nivel = await this.politica.nivel(usuario, petId);
    if (nivel !== 'RESPONSAVEL_PRINCIPAL' && nivel !== 'RESPONSAVEL')
      throw Erros.naoEncontrado('Pet não encontrado');
  }

  private resposta(c: {
    id: string;
    empresaId: string | null;
    destinatarioEmail: string | null;
    escopos: Escopo[];
    dataExpiracao: Date | null;
    status: SituacaoLink;
  }): Compartilhamento {
    return {
      id: c.id,
      empresaId: c.empresaId ?? undefined,
      destinatarioEmail: c.destinatarioEmail ?? undefined,
      escopos: c.escopos,
      dataExpiracao: c.dataExpiracao?.toISOString(),
      status: situacao(c, new Date()),
    };
  }
}
