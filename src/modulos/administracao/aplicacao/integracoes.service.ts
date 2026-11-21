import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import type { Ambiente } from '../../../compartilhado/config/ambiente';
import { Cifragem } from '../../../compartilhado/cripto/cifragem';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import {
  EVENTOS_WEBHOOK,
  motivoUrlInvalida,
} from '../../../compartilhado/webhooks/webhook';
import type { EventoWebhook } from '../../../compartilhado/webhooks/webhook';

export type TipoIntegracao =
  | 'CALENDARIO'
  | 'PAGAMENTO'
  | 'PLATAFORMA_VETERINARIA'
  | 'NOTIFICACAO'
  | 'OUTRA';

export interface Integracao {
  id: string;
  nome: string;
  tipo: TipoIntegracao;
  endpointUrl: string;
  parametros?: string;
  ativa: boolean;
  /** As credenciais nunca saem da API; só se sabe que estão guardadas. */
  temCredenciais: boolean;
}

export interface Webhook {
  id: string;
  url: string;
  eventos: string[];
  metodoAutenticacao: string;
  ativo: boolean;
  integracaoId?: string;
  /** Só na criação: o segredo não é mostrado de novo. */
  segredo?: string;
}

/** Integrações (UC-27, RN33) e webhooks de saída (UC-30, RN36) da plataforma. */
@Injectable()
export class IntegracoesService {
  private readonly cifragem: Cifragem;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Ambiente, true>,
  ) {
    this.cifragem = new Cifragem(
      config.get('CHAVE_CRIPTOGRAFIA', { infer: true }),
    );
  }

  async integracoes(): Promise<Integracao[]> {
    const lista = await this.prisma.integracao.findMany({
      orderBy: { nome: 'asc' },
    });
    return lista.map((i) => this.integracao(i));
  }

  /** CT-27-01: credenciais cifradas antes de gravar (ARQ-03, seção 4). */
  async criarIntegracao(
    admin: UsuarioAutenticado,
    dados: {
      nome: string;
      tipo: TipoIntegracao;
      endpointUrl: string;
      credenciais: string;
      parametros?: string;
    },
  ): Promise<Integracao> {
    this.garantirUrl('endpointUrl', dados.endpointUrl);
    const criada = await this.prisma.integracao.create({
      data: {
        nome: dados.nome.trim(),
        tipo: dados.tipo,
        endpointUrl: dados.endpointUrl,
        credenciaisCifradas: this.cifrar(dados.credenciais),
        parametros: dados.parametros?.trim() || null,
        ativa: true,
        configuradaPorId: admin.sub,
      },
    });
    return this.integracao(criada);
  }

  async alterarIntegracao(
    id: string,
    dados: {
      nome?: string;
      endpointUrl?: string;
      credenciais?: string;
      parametros?: string;
      ativa?: boolean;
    },
  ): Promise<Integracao> {
    await this.buscarIntegracao(id);
    if (dados.endpointUrl) this.garantirUrl('endpointUrl', dados.endpointUrl);
    const alterada = await this.prisma.integracao.update({
      where: { id },
      data: {
        nome: dados.nome?.trim(),
        endpointUrl: dados.endpointUrl,
        credenciaisCifradas: dados.credenciais
          ? this.cifrar(dados.credenciais)
          : undefined,
        parametros: dados.parametros?.trim(),
        ativa: dados.ativa,
      },
    });
    return this.integracao(alterada);
  }

  /** "A integração é salva e testada" (CT-27-01): o endereço responde? */
  async testarIntegracao(
    id: string,
  ): Promise<{ ok: boolean; status?: number; detalhe: string }> {
    const integracao = await this.buscarIntegracao(id);
    try {
      const resposta = await fetch(integracao.endpointUrl, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(5_000),
      });
      return {
        ok: resposta.status < 500,
        status: resposta.status,
        detalhe:
          resposta.status < 500
            ? 'O serviço respondeu.'
            : 'O serviço respondeu com erro.',
      };
    } catch {
      return { ok: false, detalhe: 'O serviço não respondeu em 5 segundos.' };
    }
  }

  async webhooks(): Promise<Webhook[]> {
    const lista = await this.prisma.webhook.findMany({
      orderBy: { criadoEm: 'desc' },
    });
    return lista.map((w) => this.webhook(w));
  }

  /**
   * CT-30-01 e CT-30-02: só URL HTTPS pública com assinatura HMAC-SHA256 (RN36). Sem
   * segredo informado, a API gera um; ele aparece só nesta resposta.
   */
  async criarWebhook(
    admin: UsuarioAutenticado,
    dados: {
      url: string;
      eventos: string[];
      metodoAutenticacao: string;
      segredo?: string;
      integracaoId?: string;
    },
  ): Promise<Webhook> {
    this.garantirUrl('url', dados.url);
    if (dados.metodoAutenticacao !== 'HMAC_SHA256') {
      throw Erros.dadosInvalidos(
        'metodoAutenticacao',
        'Os webhooks precisam de assinatura HMAC-SHA256 (RN36).',
      );
    }
    const desconhecidos = dados.eventos.filter(
      (e) => !(EVENTOS_WEBHOOK as readonly string[]).includes(e),
    );
    if (dados.eventos.length === 0 || desconhecidos.length > 0) {
      throw Erros.dadosInvalidos(
        'eventos',
        `Escolha entre: ${EVENTOS_WEBHOOK.join(', ')}.`,
      );
    }
    if (dados.integracaoId) await this.buscarIntegracao(dados.integracaoId);
    const segredo = dados.segredo ?? randomBytes(32).toString('base64url');
    const criado = await this.prisma.webhook.create({
      data: {
        url: dados.url,
        eventos: [...new Set(dados.eventos)] as EventoWebhook[],
        segredoAssinatura: this.cifrar(segredo),
        metodoAutenticacao: 'HMAC_SHA256',
        ativo: true,
        configuradoPorId: admin.sub,
        integracaoId: dados.integracaoId,
      },
    });
    return { ...this.webhook(criado), segredo };
  }

  async alterarWebhook(
    id: string,
    dados: { ativo?: boolean; eventos?: string[] },
  ): Promise<Webhook> {
    const atual = await this.prisma.webhook.findUnique({ where: { id } });
    if (!atual) throw Erros.naoEncontrado('Webhook não encontrado');
    if (
      dados.eventos &&
      (dados.eventos.length === 0 ||
        dados.eventos.some(
          (e) => !(EVENTOS_WEBHOOK as readonly string[]).includes(e),
        ))
    ) {
      throw Erros.dadosInvalidos(
        'eventos',
        `Escolha entre: ${EVENTOS_WEBHOOK.join(', ')}.`,
      );
    }
    const alterado = await this.prisma.webhook.update({
      where: { id },
      data: { ativo: dados.ativo, eventos: dados.eventos },
    });
    return this.webhook(alterado);
  }

  private garantirUrl(campo: string, url: string) {
    const motivo = motivoUrlInvalida(url);
    if (motivo) throw Erros.dadosInvalidos(campo, motivo);
  }

  private cifrar(texto: string): string {
    return Buffer.from(this.cifragem.cifrar(texto)).toString('base64');
  }

  private async buscarIntegracao(id: string) {
    const integracao = await this.prisma.integracao.findUnique({
      where: { id },
    });
    if (!integracao) throw Erros.naoEncontrado('Integração não encontrada');
    return integracao;
  }

  private integracao(i: {
    id: string;
    nome: string;
    tipo: TipoIntegracao;
    endpointUrl: string;
    parametros: string | null;
    ativa: boolean;
    credenciaisCifradas: string;
  }): Integracao {
    return {
      id: i.id,
      nome: i.nome,
      tipo: i.tipo,
      endpointUrl: i.endpointUrl,
      parametros: i.parametros ?? undefined,
      ativa: i.ativa,
      temCredenciais: i.credenciaisCifradas.length > 0,
    };
  }

  private webhook(w: {
    id: string;
    url: string;
    eventos: string[];
    metodoAutenticacao: string;
    ativo: boolean;
    integracaoId: string | null;
  }): Webhook {
    return {
      id: w.id,
      url: w.url,
      eventos: w.eventos,
      metodoAutenticacao: w.metodoAutenticacao,
      ativo: w.ativo,
      integracaoId: w.integracaoId ?? undefined,
    };
  }
}
