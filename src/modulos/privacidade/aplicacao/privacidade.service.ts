import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verify } from '@node-rs/argon2';
import { AuditoriaService } from '../../../compartilhado/auditoria/auditoria.service';
import { SessoesRevogadas } from '../../../compartilhado/auth/sessoes-revogadas';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import type { Ambiente } from '../../../compartilhado/config/ambiente';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import {
  aceiteVigente,
  emailAnonimo,
  hashAnonimo,
  termosDaConta,
} from '../dominio/privacidade';
import type { TipoTermo } from '../dominio/privacidade';

export interface Termo {
  id: string;
  tipo: TipoTermo;
  versao: string;
  titulo: string;
  conteudo: string;
  dataVigencia: string;
  obrigatorio: boolean;
}

export interface SituacaoConsentimento {
  termoId: string;
  tipo: TipoTermo;
  titulo: string;
  versao: string;
  obrigatorio: boolean;
  aceito: boolean;
  dataAceite?: string;
  meioColeta?: string;
}

export type TipoSolicitacao =
  'EXPORTACAO_DADOS' | 'EXCLUSAO_DADOS' | 'CORRECAO_DADOS';

const dia = (d: Date) => d.toISOString().slice(0, 10);

/** Privacidade e consentimentos (UC-46): termos, consentimentos e direitos do titular. */
@Injectable()
export class PrivacidadeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly revogadas: SessoesRevogadas,
    private readonly config: ConfigService<Ambiente, true>,
  ) {}

  /** RN42: a versão vigente de cada termo é a de vigência mais recente até hoje. */
  async termosVigentes(tipos?: TipoTermo[]): Promise<Termo[]> {
    const termos = await this.prisma.termoUso.findMany({
      where: {
        dataVigencia: { lte: new Date() },
        tipo: tipos ? { in: tipos } : { not: 'CONSENTIMENTO_CLIENTE' as const },
      },
      orderBy: { dataVigencia: 'desc' },
    });
    const vistos = new Set<string>();
    return termos
      .filter((t) => !vistos.has(t.tipo) && vistos.add(t.tipo))
      .map((t) => ({
        id: t.id,
        tipo: t.tipo,
        versao: t.versao,
        titulo: t.titulo,
        conteudo: t.conteudo,
        dataVigencia: dia(t.dataVigencia),
        obrigatorio: t.obrigatorio,
      }));
  }

  /**
   * Painel de privacidade (UC-46, passos 2 e 3) e CT-46-03: termo obrigatório vigente sem
   * aceite aparece com `aceito: false`, e o app pede o aceite antes de liberar as telas.
   */
  async consentimentos(
    usuario: UsuarioAutenticado,
  ): Promise<SituacaoConsentimento[]> {
    const termos = await this.termosVigentes(termosDaConta(usuario.tipo));
    const registros = await this.prisma.consentimento.findMany({
      where: {
        usuarioId: usuario.sub,
        termoId: { in: termos.map((t) => t.id) },
      },
    });
    return termos.map((t) => {
      const doTermo = registros.filter((r) => r.termoId === t.id);
      const situacao = aceiteVigente(doTermo);
      return {
        termoId: t.id,
        tipo: t.tipo,
        titulo: t.titulo,
        versao: t.versao,
        obrigatorio: t.obrigatorio,
        aceito: situacao.aceito,
        dataAceite: situacao.dataAceite?.toISOString(),
        meioColeta: situacao.aceito
          ? doTermo.find((r) => r.dataAceite === situacao.dataAceite)
              ?.meioColeta
          : undefined,
      };
    });
  }

  /**
   * CT-46-01 e CT-46-02: aceita versões vigentes e revoga só os opcionais; revogar um
   * obrigatório é recusado com a sugestão de excluir a conta (RN25). Tudo vai para a auditoria.
   */
  async atualizar(
    usuario: UsuarioAutenticado,
    alteracoes: { termoId: string; aceito: boolean }[],
    ip: string,
  ): Promise<void> {
    const vigentes = new Map(
      (await this.termosVigentes(termosDaConta(usuario.tipo))).map((t) => [
        t.id,
        t,
      ]),
    );
    for (const a of alteracoes) {
      const termo = vigentes.get(a.termoId);
      if (!termo) {
        throw Erros.dadosInvalidos(
          'termoId',
          'Escolha um termo vigente da sua conta.',
        );
      }
      if (!a.aceito && termo.obrigatorio) {
        throw Erros.conflito(
          'RN25_TERMO_OBRIGATORIO',
          `${termo.titulo} é obrigatório para usar o Jaguara. Se não concorda, você pode excluir a conta e os dados em Privacidade.`,
        );
      }
    }
    const agora = new Date();
    for (const a of alteracoes) {
      const termo = vigentes.get(a.termoId)!;
      const atual = aceiteVigente(
        await this.prisma.consentimento.findMany({
          where: { usuarioId: usuario.sub, termoId: a.termoId },
        }),
      );
      if (a.aceito && !atual.aceito) {
        await this.prisma.consentimento.create({
          data: {
            usuarioId: usuario.sub,
            termoId: a.termoId,
            aceito: true,
            dataAceite: agora,
            meioColeta: 'ACEITE_NO_APP',
            ipOrigem: ip.slice(0, 255),
          },
        });
      } else if (!a.aceito && atual.aceito) {
        await this.prisma.consentimento.updateMany({
          where: {
            usuarioId: usuario.sub,
            termoId: a.termoId,
            dataRevogacao: null,
          },
          data: { dataRevogacao: agora },
        });
      } else {
        continue;
      }
      await this.auditoria.registrar({
        acao: a.aceito ? 'CONSENTIMENTO_ACEITO' : 'CONSENTIMENTO_REVOGADO',
        entidade: 'TermoUso',
        entidadeId: a.termoId,
        nivel: 'INFO',
        autorId: usuario.sub,
        ip,
        detalhes: `${termo.tipo} versão ${termo.versao}`,
      });
    }
  }

  /** Pedido do titular (LGPD art. 18): exportação na hora, exclusão com senha, correção para o suporte. */
  async solicitar(
    usuario: UsuarioAutenticado,
    tipo: TipoSolicitacao,
    senha: string | undefined,
    ip: string,
  ): Promise<{ id: string; tipo: TipoSolicitacao; status: string }> {
    if (tipo === 'EXCLUSAO_DADOS') await this.conferirSenha(usuario, senha);
    const imediata =
      tipo === 'EXPORTACAO_DADOS' ||
      (tipo === 'EXCLUSAO_DADOS' && usuario.tipo === 'TUTOR');
    const solicitacao = await this.prisma.solicitacaoPrivacidade.create({
      data: {
        usuarioId: usuario.sub,
        tipo,
        dataSolicitacao: new Date(),
        status: imediata ? 'EM_PROCESSAMENTO' : 'ABERTA',
      },
    });
    await this.auditoria.registrar({
      acao: `PRIVACIDADE_${tipo}`,
      entidade: 'SolicitacaoPrivacidade',
      entidadeId: solicitacao.id,
      nivel: tipo === 'EXCLUSAO_DADOS' ? 'CRITICO' : 'INFO',
      autorId: usuario.sub,
      ip,
    });
    if (tipo === 'EXCLUSAO_DADOS' && usuario.tipo === 'TUTOR') {
      await this.excluirTutor(usuario.sub);
    }
    if (!imediata) return { id: solicitacao.id, tipo, status: 'ABERTA' };
    await this.prisma.solicitacaoPrivacidade.update({
      where: { id: solicitacao.id },
      data: { status: 'CONCLUIDA', dataConclusao: new Date() },
    });
    return { id: solicitacao.id, tipo, status: 'CONCLUIDA' };
  }

  /** Portabilidade (LGPD art. 18, V): os dados do titular em JSON. */
  async exportar(usuario: UsuarioAutenticado) {
    const conta = await this.prisma.usuario.findUniqueOrThrow({
      where: { id: usuario.sub },
      select: {
        email: true,
        telefone: true,
        dataCadastro: true,
        tutor: {
          select: {
            nome: true,
            dataNascimento: true,
            enderecoCep: true,
            enderecoLogradouro: true,
            enderecoNumero: true,
            enderecoComplemento: true,
            enderecoBairro: true,
            enderecoCidade: true,
            enderecoUf: true,
          },
        },
      },
    });
    const vinculos = await this.prisma.responsavelPet.findMany({
      where: { tutorId: usuario.sub, ativo: true },
      select: { petId: true, tipo: true },
    });
    const petIds = vinculos.map((v) => v.petId);
    const [pets, clinicos, despesas, eventos, refeicoes, consentimentos] =
      await Promise.all([
        this.prisma.pet.findMany({
          where: { id: { in: petIds } },
          include: {
            raca: { include: { especie: true } },
            alergiaRestricao: true,
          },
        }),
        this.prisma.registroClinico.findMany({
          where: { petId: { in: petIds }, valido: true },
          include: {
            vacinacao: true,
            exame: true,
            tratamentoMedicamentoso: true,
          },
        }),
        this.prisma.despesa.findMany({
          where: { petId: { in: petIds } },
          include: { categoria: true },
        }),
        this.prisma.eventoCalendario.findMany({
          where: { petId: { in: petIds } },
        }),
        this.prisma.registroAlimentacao.findMany({
          where: { petId: { in: petIds } },
        }),
        this.prisma.consentimento.findMany({
          where: { usuarioId: usuario.sub },
          include: { termo: { select: { tipo: true, versao: true } } },
        }),
      ]);
    return {
      geradoEm: new Date().toISOString(),
      conta: {
        email: conta.email,
        telefone: conta.telefone,
        dataCadastro: conta.dataCadastro.toISOString(),
        ...(conta.tutor
          ? {
              ...conta.tutor,
              dataNascimento: conta.tutor.dataNascimento
                ? dia(conta.tutor.dataNascimento)
                : null,
            }
          : {}),
      },
      pets: pets.map((p) => ({
        nome: p.nome,
        especie: p.raca.especie.nome,
        raca: p.raca.nome,
        sexo: p.sexo,
        dataNascimento: p.dataNascimento ? dia(p.dataNascimento) : null,
        castrado: p.castrado,
        responsabilidade: vinculos.find((v) => v.petId === p.id)?.tipo,
        alergias: p.alergiaRestricao.map((a) => ({
          tipo: a.tipo,
          descricao: a.descricao,
          gravidade: a.gravidade,
        })),
        vacinas: clinicos
          .filter((c) => c.petId === p.id && c.vacinacao)
          .map((c) => ({
            nomeVacina: c.vacinacao!.nomeVacina,
            dataAplicacao: dia(c.vacinacao!.dataAplicacao),
            responsavelAplicacao: c.vacinacao!.responsavelAplicacao,
          })),
        exames: clinicos
          .filter((c) => c.petId === p.id && c.exame)
          .map((c) => ({
            tipoExame: c.exame!.tipoExame,
            dataRealizacao: dia(c.exame!.dataRealizacao),
            resultado: c.exame!.resultado,
          })),
        tratamentos: clinicos
          .filter((c) => c.petId === p.id && c.tratamentoMedicamentoso)
          .map((c) => ({
            medicamento: c.tratamentoMedicamentoso!.medicamento,
            dosagem: c.tratamentoMedicamentoso!.dosagem,
            dataInicio: dia(c.tratamentoMedicamentoso!.dataInicio),
            status: c.tratamentoMedicamentoso!.status,
          })),
        despesas: despesas
          .filter((d) => d.petId === p.id)
          .map((d) => ({
            descricao: d.descricao,
            valor: d.valor.toNumber(),
            data: dia(d.data),
            categoria: d.categoria.nome,
          })),
        eventos: eventos
          .filter((e) => e.petId === p.id)
          .map((e) => ({
            titulo: e.titulo,
            tipo: e.tipo,
            dataHoraInicio: e.dataHoraInicio.toISOString(),
          })),
        refeicoes: refeicoes
          .filter((r) => r.petId === p.id)
          .map((r) => ({
            dataHora: r.dataHora.toISOString(),
            alimento: r.alimento,
            quantidadeGramas: r.quantidadeGramas.toNumber(),
          })),
      })),
      consentimentos: consentimentos.map((c) => ({
        termo: c.termo.tipo,
        versao: c.termo.versao,
        aceito: c.aceito,
        dataAceite: c.dataAceite.toISOString(),
        dataRevogacao: c.dataRevogacao?.toISOString() ?? null,
      })),
    };
  }

  private async conferirSenha(usuario: UsuarioAutenticado, senha?: string) {
    if (!senha) {
      throw Erros.dadosInvalidos('senha', 'Digite a sua senha para confirmar.');
    }
    const conta = await this.prisma.usuario.findUniqueOrThrow({
      where: { id: usuario.sub },
      select: { senhaHash: true },
    });
    if (!conta.senhaHash || !(await verify(conta.senhaHash, senha))) {
      throw Erros.dadosInvalidos('senha', 'Senha incorreta.');
    }
  }

  /**
   * Direito ao esquecimento (UC-46, FA2): anonimiza a conta, passa os pets compartilhados
   * para outro responsável, anonimiza os pets que eram só dele e encerra as sessões.
   */
  private async excluirTutor(usuarioId: string): Promise<void> {
    const vinculos = await this.prisma.responsavelPet.findMany({
      where: { tutorId: usuarioId, ativo: true },
      select: { id: true, petId: true, tipo: true },
    });
    const sessoes = await this.prisma.sessao.findMany({
      where: { usuarioId },
      select: { id: true },
    });
    await this.prisma.$transaction(async (tx) => {
      for (const v of vinculos) {
        const outro = await tx.responsavelPet.findFirst({
          where: { petId: v.petId, ativo: true, tutorId: { not: usuarioId } },
          orderBy: { dataVinculo: 'asc' },
        });
        if (outro) {
          if (v.tipo === 'PRINCIPAL') {
            await tx.responsavelPet.update({
              where: { id: outro.id },
              data: { tipo: 'PRINCIPAL' },
            });
          }
        } else {
          await tx.pet.update({
            where: { id: v.petId },
            data: {
              nome: 'Pet removido',
              microchip: null,
              fotoUrl: null,
              cor: null,
              status: 'ARQUIVADO',
            },
          });
          await tx.compartilhamentoPet.updateMany({
            where: { petId: v.petId, status: 'ATIVO' },
            data: { status: 'REVOGADO' },
          });
        }
        await tx.responsavelPet.update({
          where: { id: v.id },
          data: { ativo: false },
        });
      }
      await tx.tutor.update({
        where: { id: usuarioId },
        data: {
          nome: 'Usuário excluído',
          cpfCifrado: new Uint8Array(0),
          cpfHash: hashAnonimo(usuarioId),
          dataNascimento: null,
          enderecoCep: null,
          enderecoLogradouro: null,
          enderecoNumero: null,
          enderecoComplemento: null,
          enderecoBairro: null,
          enderecoCidade: null,
          enderecoUf: null,
        },
      });
      await tx.usuario.update({
        where: { id: usuarioId },
        data: {
          email: emailAnonimo(usuarioId),
          senhaHash: null,
          telefone: null,
          status: 'INATIVA',
        },
      });
      await tx.notificacao.updateMany({
        where: { destinatarioId: usuarioId, status: 'AGENDADA' },
        data: { status: 'CANCELADA' },
      });
      await tx.sessao.deleteMany({ where: { usuarioId } });
    });
    const segundos =
      this.config.get('JWT_EXPIRACAO_MINUTOS', { infer: true }) * 60;
    await Promise.all(
      sessoes.map((s) => this.revogadas.revogar(s.id, segundos)),
    );
  }
}
