import { Logger } from '@nestjs/common';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import type { EnvioPush } from './envio-push';

export const URL_EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';

interface RecibosExpo {
  data?: {
    status: 'ok' | 'error';
    message?: string;
    details?: { error?: string };
  }[];
  errors?: { message: string }[];
}

/** Token no formato do Expo: ExponentPushToken[...] ou ExpoPushToken[...]. */
export const tokenExpoValido = (token: string) =>
  /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);

/**
 * Push pelo serviço do Expo (ARQ-03, UC-31): um envio por aparelho do destinatário. Aparelho
 * desinstalado (DeviceNotRegistered) sai da lista; recusa de todos os aparelhos lança erro e
 * o disparo tenta de novo com espera crescente.
 */
export class EnvioPushExpo implements EnvioPush {
  readonly nome = 'expo';
  private readonly log = new Logger(EnvioPushExpo.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenAcesso?: string,
    private readonly http: typeof fetch = (...a) => fetch(...a),
  ) {}

  async enviar(
    destinatarioId: string,
    titulo: string,
    mensagem: string,
  ): Promise<void> {
    const aparelhos = await this.prisma.dispositivoPush.findMany({
      where: { usuarioId: destinatarioId },
      select: { token: true },
    });
    if (aparelhos.length === 0) {
      // Sem aparelho registrado: a notificação continua na lista do app (GET /notificacoes).
      this.log.log(`Sem aparelho para push de ${destinatarioId}`);
      return;
    }
    const resposta = await this.http(URL_EXPO_PUSH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(this.tokenAcesso
          ? { Authorization: `Bearer ${this.tokenAcesso}` }
          : {}),
      },
      body: JSON.stringify(
        aparelhos.map((a) => ({
          to: a.token,
          title: titulo,
          body: mensagem,
          sound: 'default',
        })),
      ),
    });
    if (!resposta.ok) {
      throw new Error(`Expo respondeu ${resposta.status}`);
    }
    const recibos = (await resposta.json()) as RecibosExpo;
    const itens = recibos.data ?? [];
    const desinstalados = aparelhos
      .filter((_, i) => itens[i]?.details?.error === 'DeviceNotRegistered')
      .map((a) => a.token);
    if (desinstalados.length > 0) {
      await this.prisma.dispositivoPush.deleteMany({
        where: { token: { in: desinstalados } },
      });
    }
    const aceitos = itens.filter((i) => i.status === 'ok').length;
    if (aceitos === 0 && desinstalados.length < aparelhos.length) {
      throw new Error(
        itens.find((i) => i.message)?.message ??
          recibos.errors?.[0]?.message ??
          'Push recusado',
      );
    }
  }
}
