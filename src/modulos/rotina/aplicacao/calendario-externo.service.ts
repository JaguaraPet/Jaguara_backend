import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import type { Ambiente } from '../../../compartilhado/config/ambiente';
import { Cifragem } from '../../../compartilhado/cripto/cifragem';
import { ErroNegocio, Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { PoliticaAcessoPet } from '../../pet/aplicacao/politica-acesso-pet';
import {
  assinarEstado,
  mesclar,
  verificarEstado,
} from '../dominio/calendario-externo';
import { PROVEDOR_CALENDARIO } from '../infra/provedor-calendario';
import type { ProvedorCalendario } from '../infra/provedor-calendario';

export interface SituacaoCalendario {
  provedor: 'GOOGLE';
  conta: string;
  autorizado: boolean;
  ultimaSincronizacao?: string;
}

export type ResultadoRetorno = 'conectado' | 'negado' | 'erro';

/** Janela da sincronização: de agora aos próximos 30 dias, como a agenda do app. */
const DIAS_SINCRONIZADOS = 30;

/** Calendário externo do tutor (UC-09, RN13): só calendário autorizado entra na agenda. */
@Injectable()
export class CalendarioExternoService {
  private readonly log = new Logger(CalendarioExternoService.name);
  private readonly cifragem: Cifragem;

  constructor(
    private readonly prisma: PrismaService,
    private readonly politicaPet: PoliticaAcessoPet,
    private readonly config: ConfigService<Ambiente, true>,
    @Inject(PROVEDOR_CALENDARIO) private readonly provedor: ProvedorCalendario,
  ) {
    this.cifragem = new Cifragem(
      config.get('CHAVE_CRIPTOGRAFIA', { infer: true }),
    );
  }

  /** Endereço de retorno do OAuth na API pública. */
  get retorno(): string {
    const base =
      this.config.get('URL_API_PUBLICA', { infer: true }) ||
      'http://localhost:3000';
    return `${base.replace(/\/$/, '')}/v1/calendario-externo/google/retorno`;
  }

  async situacao(
    usuario: UsuarioAutenticado,
  ): Promise<SituacaoCalendario | null> {
    const c = await this.buscar(usuario.sub);
    if (!c) return null;
    return {
      provedor: 'GOOGLE',
      conta: c.contaExterna,
      autorizado: c.autorizado,
      ultimaSincronizacao: c.ultimaSincronizacao?.toISOString(),
    };
  }

  /** Passo 3 e 4: endereço do consentimento, ligado ao tutor pelo estado assinado. */
  iniciarAutorizacao(usuario: UsuarioAutenticado): { url: string } {
    const estado = assinarEstado(
      usuario.sub,
      this.config.get('JWT_SECRET', { infer: true }),
    );
    return { url: this.provedor.urlAutorizacao(estado, this.retorno) };
  }

  /**
   * Retorno do provedor (passo 5). CT-09-02: acesso negado ou estado inválido não guarda nada.
   * Devolve o resultado para o app mostrar.
   */
  async concluirAutorizacao(q: {
    code?: string;
    state?: string;
    error?: string;
  }): Promise<ResultadoRetorno> {
    const usuarioId = q.state
      ? verificarEstado(q.state, this.config.get('JWT_SECRET', { infer: true }))
      : null;
    if (!usuarioId) return 'erro';
    if (q.error || !q.code) return 'negado';
    try {
      const { tokenAtualizacao, conta } = await this.provedor.trocarCodigo(
        q.code,
        this.retorno,
      );
      const token = Buffer.from(
        this.cifragem.cifrar(tokenAtualizacao),
      ).toString('base64');
      const atual = await this.buscar(usuarioId);
      const dados = {
        contaExterna: conta.slice(0, 255),
        tokenAutorizacao: token,
        autorizado: true,
      };
      if (atual) {
        await this.prisma.calendarioExterno.update({
          where: { id: atual.id },
          data: dados,
        });
      } else {
        await this.prisma.calendarioExterno.create({
          data: { ...dados, provedor: 'GOOGLE', usuarioId },
        });
      }
      return 'conectado';
    } catch (erro) {
      this.log.warn(`Autorização do calendário falhou: ${String(erro)}`);
      return 'erro';
    }
  }

  /** CT-09-01: importa os compromissos dos próximos 30 dias para a agenda do pet. */
  async sincronizar(usuario: UsuarioAutenticado, petId: string) {
    const nivel = await this.politicaPet.nivel(usuario, petId);
    if (nivel !== 'RESPONSAVEL_PRINCIPAL' && nivel !== 'RESPONSAVEL') {
      throw Erros.naoEncontrado('Pet não encontrado');
    }
    const c = await this.buscar(usuario.sub);
    if (!c || !c.autorizado) {
      throw Erros.conflito(
        'RN13_SEM_AUTORIZACAO',
        'Autorize o acesso ao seu calendário antes de sincronizar.',
      );
    }
    const agora = new Date();
    const ate = new Date(agora.getTime() + DIAS_SINCRONIZADOS * 86_400_000);
    let externos;
    try {
      const token = this.cifragem.decifrar(
        Buffer.from(c.tokenAutorizacao, 'base64'),
      );
      externos = await this.provedor.listarEventos(token, agora, ate);
    } catch (erro) {
      if (String(erro).includes('AUTORIZACAO_REVOGADA')) {
        await this.prisma.calendarioExterno.update({
          where: { id: c.id },
          data: { autorizado: false },
        });
        throw Erros.conflito(
          'RN13_SEM_AUTORIZACAO',
          'O acesso ao calendário foi revogado. Autorize de novo para sincronizar.',
        );
      }
      throw new ErroNegocio(
        HttpStatus.SERVICE_UNAVAILABLE,
        'CALENDARIO_INDISPONIVEL',
        'Calendário indisponível no momento',
        'Não conseguimos falar com o Google Agenda. Tente de novo em instantes.',
      );
    }
    const importados = await this.prisma.eventoCalendario.findMany({
      where: {
        petId,
        calendarioExternoId: c.id,
        dataHoraInicio: { gte: agora },
      },
      select: { id: true, idExterno: true },
    });
    const { criar, atualizar, remover } = mesclar(importados, externos);
    const campos = (e: (typeof externos)[number]) => ({
      titulo: e.titulo,
      descricao: e.descricao ?? null,
      local: e.local ?? null,
      dataHoraInicio: e.inicio,
      dataHoraFim: e.fim ?? null,
    });
    await this.prisma.$transaction([
      ...criar.map((e) =>
        this.prisma.eventoCalendario.create({
          data: {
            ...campos(e),
            tipo: 'COMPROMISSO',
            origem: 'CALENDARIO_EXTERNO',
            idExterno: e.idExterno,
            petId,
            criadoPorId: usuario.sub,
            calendarioExternoId: c.id,
          },
        }),
      ),
      ...atualizar.map((a) =>
        this.prisma.eventoCalendario.update({
          where: { id: a.id },
          data: campos(a.evento),
        }),
      ),
      this.prisma.eventoCalendario.deleteMany({
        where: { id: { in: remover } },
      }),
      this.prisma.calendarioExterno.update({
        where: { id: c.id },
        data: { ultimaSincronizacao: agora },
      }),
    ]);
    return {
      importados: criar.length,
      atualizados: atualizar.length,
      removidos: remover.length,
    };
  }

  /** Desconecta: apaga a autorização e os compromissos importados (RN13). */
  async desconectar(usuario: UsuarioAutenticado): Promise<void> {
    const c = await this.buscar(usuario.sub);
    if (!c) return;
    await this.prisma.$transaction([
      this.prisma.eventoCalendario.deleteMany({
        where: { calendarioExternoId: c.id },
      }),
      this.prisma.calendarioExterno.delete({ where: { id: c.id } }),
    ]);
  }

  private buscar(usuarioId: string) {
    return this.prisma.calendarioExterno.findFirst({
      where: { usuarioId, provedor: 'GOOGLE' },
    });
  }
}
