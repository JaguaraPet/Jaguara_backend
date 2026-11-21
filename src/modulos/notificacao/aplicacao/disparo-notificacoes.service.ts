import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditoriaService } from '../../../compartilhado/auditoria/auditoria.service';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { aposFalha } from '../dominio/programacao';
import { ENVIO_PUSH } from '../infra/envio-push';
import type { EnvioPush } from '../infra/envio-push';
import { FilaEmailService } from './fila-email.service';

/** Quantas notificações vencidas o worker trata por rodada. */
const LOTE = 200;

/**
 * Disparo das notificações vencidas (DS-06): envia pelo canal configurado, marca ENVIADA ou,
 * na falha, reagenda com espera exponencial até 5 tentativas (CT-31-02).
 */
@Injectable()
export class DisparoNotificacoesService {
  private readonly log = new Logger(DisparoNotificacoesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fila: FilaEmailService,
    private readonly auditoria: AuditoriaService,
    @Inject(ENVIO_PUSH) private readonly push: EnvioPush,
  ) {}

  async disparar(
    agora = new Date(),
  ): Promise<{ enviadas: number; falhas: number }> {
    const vencidas = await this.prisma.notificacao.findMany({
      where: { status: 'AGENDADA', dataProgramada: { lte: agora } },
      include: { destinatario: { select: { email: true } } },
      orderBy: { dataProgramada: 'asc' },
      take: LOTE,
    });
    let enviadas = 0;
    let falhas = 0;
    for (const n of vencidas) {
      try {
        if (n.canal === 'EMAIL') {
          await this.fila.enviar('NOTIFICACAO', n.destinatario.email, {
            titulo: n.titulo,
            mensagem: n.mensagem,
          });
        } else {
          await this.push.enviar(n.destinatarioId, n.titulo, n.mensagem);
        }
        await this.prisma.notificacao.updateMany({
          where: { id: n.id, status: 'AGENDADA' },
          data: { status: 'ENVIADA', dataEnvio: new Date() },
        });
        enviadas += 1;
      } catch (erro) {
        falhas += 1;
        await this.registrarFalha(n, erro, agora);
      }
    }
    return { enviadas, falhas };
  }

  private async registrarFalha(
    n: { id: string; tentativas: number; titulo: string },
    erro: unknown,
    agora: Date,
  ) {
    const decisao = aposFalha(n.tentativas, agora);
    await this.prisma.notificacao.update({
      where: { id: n.id },
      data:
        decisao.status === 'FALHOU'
          ? { status: 'FALHOU', tentativas: n.tentativas + 1 }
          : { tentativas: n.tentativas + 1, dataProgramada: decisao.proxima },
    });
    this.log.warn(`Falha ao enviar a notificação ${n.id}: ${String(erro)}`);
    if (decisao.status === 'FALHOU') {
      await this.auditoria.registrar({
        acao: 'NOTIFICACAO_FALHOU',
        entidade: 'Notificacao',
        entidadeId: n.id,
        nivel: 'ALERTA',
        detalhes: `${n.titulo}: ${String(erro).slice(0, 500)}`,
      });
    }
  }
}
