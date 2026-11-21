import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { PublicadorWebhook } from '../../../compartilhado/webhooks/publicador-webhook';
import { CanalTempoReal } from '../../comunicacao/aplicacao/canal-tempo-real';
import { salaEmpresa, salaUsuario } from '../../comunicacao/dominio/conversa';
import { FilaEmailService } from '../../notificacao/aplicacao/fila-email.service';
import { PoliticaAcessoPet } from '../../pet/aplicacao/politica-acesso-pet';
import {
  GATEWAY_PAGAMENTO,
  motivoRecusa,
  podeMudar,
  PREFIXO_PROVISORIO,
} from '../dominio/pagamento';
import type {
  GatewayPagamento,
  MetodoPagamento,
  SituacaoCobranca,
  StatusPagamento,
} from '../dominio/pagamento';
import { GatewayIndisponivel } from '../infra/gateway-mercado-pago';
import { AssinaturasService } from './assinaturas.service';

export interface Pagamento {
  id: string;
  codigoTransacao: string;
  valor: number;
  dataHora: string;
  metodo: MetodoPagamento;
  status: StatusPagamento;
  dataConfirmacao?: string;
  agendamentoId?: string;
  qrCode?: string;
  motivoRecusa?: string;
}

/** Evento do Socket.IO quando o status de um pagamento muda (ADR-011). */
export const EVENTO_PAGAMENTO = 'pagamento:atualizado';

/** Pagamentos pendentes mais novos que isso esperam o webhook antes da reconciliação. */
const ESPERA_RECONCILIACAO_MS = 10 * 60_000;

/** Realizar pagamento (UC-44, DS-05) com confirmação só pelo gateway (RN39). */
@Injectable()
export class PagamentosService {
  private readonly log = new Logger(PagamentosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly politicaPet: PoliticaAcessoPet,
    private readonly fila: FilaEmailService,
    private readonly canal: CanalTempoReal,
    @Inject(GATEWAY_PAGAMENTO) private readonly gateway: GatewayPagamento,
    private readonly assinaturas: AssinaturasService,
    private readonly webhooks: PublicadorWebhook,
  ) {}

  /**
   * CT-44-01 e CT-44-02: grava o pagamento PENDENTE com o preço contratado (RN27), cria a
   * cobrança no gateway com o id do pagamento como chave de idempotência e devolve o QR code
   * do PIX ou o resultado do cartão.
   */
  async iniciar(
    usuario: UsuarioAutenticado,
    pedido: {
      agendamentoId?: string;
      assinaturaId?: string;
      metodo: MetodoPagamento;
      tokenCartao?: string;
      bandeiraCartao?: string;
      parcelas?: number;
    },
  ): Promise<Pagamento> {
    if (!pedido.agendamentoId === !pedido.assinaturaId) {
      throw Erros.dadosInvalidos(
        'agendamentoId',
        'Escolha o agendamento ou a assinatura que você vai pagar.',
      );
    }
    if (pedido.metodo === 'BOLETO') {
      throw Erros.dadosInvalidos('metodo', 'Pague com PIX ou cartão.');
    }
    const cartao = pedido.metodo !== 'PIX';
    if (cartao && (!pedido.tokenCartao || !pedido.bandeiraCartao)) {
      throw Erros.dadosInvalidos(
        'tokenCartao',
        'Informe o cartão pelo formulário seguro de pagamento.',
      );
    }

    const cobravel = pedido.agendamentoId
      ? await this.agendamentoCobravel(usuario, pedido.agendamentoId)
      : await this.assinaturaCobravel(usuario, pedido.assinaturaId!);
    const alvo = pedido.agendamentoId
      ? { agendamentoId: pedido.agendamentoId }
      : { assinaturaId: pedido.assinaturaId };
    const pago = await this.prisma.pagamento.count({
      where: { ...alvo, status: 'ACEITO' },
    });
    if (pago > 0) {
      throw Erros.conflito(
        'PAGAMENTO_JA_REALIZADO',
        pedido.agendamentoId
          ? 'Este serviço já foi pago.'
          : 'Esta assinatura já foi paga.',
      );
    }

    // Uma tentativa que não chegou ao gateway é reaproveitada, com a mesma chave de idempotência.
    const provisorio = await this.prisma.pagamento.findFirst({
      where: {
        ...alvo,
        pagadorId: usuario.sub,
        status: 'PENDENTE',
        codigoTransacao: { startsWith: PREFIXO_PROVISORIO },
      },
    });
    const id = provisorio?.id ?? randomUUID();
    const pagamento =
      provisorio && provisorio.metodo === pedido.metodo
        ? provisorio
        : await this.prisma.pagamento.upsert({
            where: { id },
            update: { metodo: pedido.metodo },
            create: {
              id,
              codigoTransacao: `${PREFIXO_PROVISORIO}${id}`,
              valor: cobravel.valor,
              dataHora: new Date(),
              metodo: pedido.metodo,
              status: 'PENDENTE',
              pagadorId: usuario.sub,
              recebedorId: cobravel.recebedorId,
              ...alvo,
            },
          });

    const { email } = await this.prisma.usuario.findUniqueOrThrow({
      where: { id: usuario.sub },
      select: { email: true },
    });
    let cobranca: SituacaoCobranca;
    try {
      cobranca = await this.gateway.criarCobranca({
        pagamentoId: pagamento.id,
        valor: pagamento.valor.toNumber(),
        metodo: pedido.metodo,
        descricao: cobravel.descricao,
        emailPagador: email,
        cartao: cartao
          ? {
              token: pedido.tokenCartao!,
              bandeira: pedido.bandeiraCartao!,
              parcelas: pedido.parcelas ?? 1,
            }
          : undefined,
      });
    } catch (erro) {
      if (erro instanceof GatewayIndisponivel)
        throw Erros.gatewayIndisponivel();
      throw erro;
    }

    await this.prisma.pagamento.update({
      where: { id: pagamento.id },
      data: { codigoTransacao: cobranca.codigoTransacao },
    });
    // O status final vem de nova consulta ao gateway, nunca só da resposta da criação (RN39).
    if (cobranca.status !== 'PENDENTE')
      await this.sincronizar(cobranca.codigoTransacao);

    const atual = await this.prisma.pagamento.findUniqueOrThrow({
      where: { id: pagamento.id },
    });
    return {
      ...this.resposta(atual),
      qrCode: cobranca.qrCode,
      motivoRecusa:
        atual.status === 'RECUSADO'
          ? motivoRecusa(cobranca.detalhe)
          : undefined,
    };
  }

  /** Serviço agendado: o responsável paga o preço contratado à empresa (RN27). */
  private async agendamentoCobravel(
    usuario: UsuarioAutenticado,
    agendamentoId: string,
  ) {
    const agendamento = await this.prisma.agendamento.findUnique({
      where: { id: agendamentoId },
      include: {
        servico: { select: { nome: true, empresaId: true } },
        pet: { select: { nome: true } },
      },
    });
    if (!agendamento) throw Erros.naoEncontrado('Agendamento não encontrado');
    const nivel = await this.politicaPet.nivel(usuario, agendamento.petId);
    if (nivel !== 'RESPONSAVEL_PRINCIPAL' && nivel !== 'RESPONSAVEL')
      throw Erros.semPermissao('Só o responsável pelo pet paga o serviço.');
    if (agendamento.status === 'CANCELADO') {
      throw Erros.conflito(
        'AGENDAMENTO_INATIVO',
        'Este agendamento foi cancelado.',
      );
    }
    return {
      valor: agendamento.precoContratado,
      descricao: `${agendamento.servico.nome} - ${agendamento.pet.nome}`,
      recebedorId: agendamento.servico.empresaId as string | null,
    };
  }

  /** Assinatura PANTERA pendente do próprio tutor, paga à plataforma. */
  private async assinaturaCobravel(
    usuario: UsuarioAutenticado,
    assinaturaId: string,
  ) {
    await this.assinaturas.pendenteDoTutor(usuario.sub, assinaturaId);
    return {
      valor: this.assinaturas.precoMensal,
      descricao: 'Assinatura PANTERA - 1 mês',
      recebedorId: null as string | null,
    };
  }

  /**
   * Webhook e reconciliação: consulta o gateway e aplica a mudança uma única vez, mesmo com
   * eventos repetidos ou fora de ordem (idempotente).
   */
  async sincronizar(codigoTransacao: string): Promise<StatusPagamento | null> {
    const pagamento = await this.prisma.pagamento.findUnique({
      where: { codigoTransacao },
      include: {
        agendamento: {
          include: {
            servico: { select: { nome: true } },
            pet: { select: { nome: true } },
          },
        },
        pagador: { include: { usuario: { select: { email: true } } } },
      },
    });
    if (!pagamento) return null;
    const situacao = await this.gateway.consultar(codigoTransacao);
    if (!situacao || !podeMudar(pagamento.status, situacao.status))
      return pagamento.status;

    const confirmadoEm = situacao.status === 'ACEITO' ? new Date() : undefined;
    const { count } = await this.prisma.pagamento.updateMany({
      where: { id: pagamento.id, status: pagamento.status },
      data: { status: situacao.status, dataConfirmacao: confirmadoEm },
    });
    if (count === 0) return pagamento.status; // outro evento já aplicou a mudança

    const salas = [salaUsuario(pagamento.pagadorId)];
    if (pagamento.recebedorId && situacao.status === 'ACEITO')
      salas.push(salaEmpresa(pagamento.recebedorId));
    this.canal.emitir(salas, EVENTO_PAGAMENTO, {
      ...this.resposta({
        ...pagamento,
        status: situacao.status,
        dataConfirmacao: confirmadoEm ?? pagamento.dataConfirmacao,
      }),
      motivoRecusa:
        situacao.status === 'RECUSADO'
          ? motivoRecusa(situacao.detalhe)
          : undefined,
    });
    if (situacao.status === 'ACEITO' && pagamento.recebedorId) {
      await this.webhooks.publicar('pagamento.confirmado', {
        pagamentoId: pagamento.id,
        agendamentoId: pagamento.agendamentoId,
        empresaId: pagamento.recebedorId,
        valor: pagamento.valor.toNumber(),
        metodo: pagamento.metodo,
        dataConfirmacao: confirmadoEm?.toISOString(),
      });
    }
    if (situacao.status === 'ACEITO' && pagamento.assinaturaId) {
      await this.assinaturas.ativar(pagamento.assinaturaId);
    }
    if (situacao.status === 'ACEITO' && pagamento.agendamento) {
      await this.fila.enviar(
        'PAGAMENTO_CONFIRMADO',
        pagamento.pagador.usuario.email,
        {
          nome: pagamento.pagador.nome,
          servico: pagamento.agendamento.servico.nome,
          pet: pagamento.agendamento.pet.nome,
          valor: pagamento.valor.toNumber().toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL',
          }),
        },
      );
    }
    this.log.log(
      `Pagamento ${pagamento.id}: ${pagamento.status} -> ${situacao.status}`,
    );
    return situacao.status;
  }

  /** Webhook perdido: confere de hora em hora os pendentes (ARQ-03, seção 3.1). */
  async reconciliar(): Promise<number> {
    const agora = Date.now();
    const pendentes = await this.prisma.pagamento.findMany({
      where: {
        status: 'PENDENTE',
        NOT: { codigoTransacao: { startsWith: PREFIXO_PROVISORIO } },
        dataHora: {
          lt: new Date(agora - ESPERA_RECONCILIACAO_MS),
          gt: new Date(agora - 30 * 86_400_000),
        },
      },
      select: { codigoTransacao: true },
      take: 200,
    });
    let alterados = 0;
    for (const { codigoTransacao } of pendentes) {
      try {
        const status = await this.sincronizar(codigoTransacao);
        if (status && status !== 'PENDENTE') alterados += 1;
      } catch (erro) {
        this.log.warn(
          `Reconciliação de ${codigoTransacao} falhou: ${String(erro)}`,
        );
      }
    }
    return alterados;
  }

  private resposta(p: {
    id: string;
    codigoTransacao: string;
    valor: { toNumber(): number };
    dataHora: Date;
    metodo: MetodoPagamento;
    status: StatusPagamento;
    dataConfirmacao: Date | null;
    agendamentoId: string | null;
  }): Pagamento {
    return {
      id: p.id,
      codigoTransacao: p.codigoTransacao,
      valor: p.valor.toNumber(),
      dataHora: p.dataHora.toISOString(),
      metodo: p.metodo,
      status: p.status,
      dataConfirmacao: p.dataConfirmacao?.toISOString(),
      agendamentoId: p.agendamentoId ?? undefined,
    };
  }
}
