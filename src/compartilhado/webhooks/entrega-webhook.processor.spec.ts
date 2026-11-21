import type { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'node:crypto';
import type { Job } from 'bullmq';
import type { AuditoriaService } from '../auditoria/auditoria.service';
import type { Ambiente } from '../config/ambiente';
import { Cifragem } from '../cripto/cifragem';
import type { PrismaService } from '../prisma/prisma.service';
import { EntregaWebhookProcessor } from './entrega-webhook.processor';
import type { EnvioWebhook } from './webhook';

describe('EntregaWebhookProcessor (ARQ-03, seção 3.7)', () => {
  const chave = randomBytes(32).toString('base64');
  const cifragem = new Cifragem(chave);
  const envio: EnvioWebhook = {
    id: 'e1',
    evento: 'agendamento.criado',
    criadoEm: '2026-11-21T12:00:00.000Z',
    dados: { agendamentoId: 'a1' },
  };

  const montar = (ativo = true) => {
    const prisma = {
      webhook: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'w1',
          url: 'https://parceiro.exemplo.com/hook',
          ativo,
          segredoAssinatura: Buffer.from(cifragem.cifrar('segredo')).toString(
            'base64',
          ),
        }),
      },
    };
    const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
    const processor = new EntregaWebhookProcessor(
      prisma as unknown as PrismaService,
      auditoria as unknown as AuditoriaService,
      { get: () => chave } as unknown as ConfigService<Ambiente, true>,
    );
    return { processor, auditoria };
  };

  const job = (attemptsMade = 0) =>
    ({ data: { webhookId: 'w1', envio }, attemptsMade }) as unknown as Job<{
      webhookId: string;
      envio: EnvioWebhook;
    }>;

  afterEach(() => jest.restoreAllMocks());

  it('deve enviar o evento com a assinatura HMAC que o parceiro consegue conferir', async () => {
    const buscar = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    const { processor } = montar();
    await expect(processor.process(job())).resolves.toBe(204);
    const [, opcoes] = buscar.mock.calls[0] as [string, RequestInit];
    const cabecalhos = opcoes.headers as Record<string, string>;
    const [t, v1] = cabecalhos['X-Jaguara-Assinatura']
      .split(',')
      .map((p) => p.split('=')[1]);
    const esperado = createHmac('sha256', 'segredo')
      .update(`${t}.${opcoes.body as string}`)
      .digest('hex');
    expect(v1).toBe(esperado);
    expect(cabecalhos['X-Jaguara-Id']).toBe('e1');
  });

  it('deve falhar para o BullMQ tentar de novo e auditar só a última tentativa', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 500 }));
    const { processor, auditoria } = montar();
    await expect(processor.process(job(0))).rejects.toThrow('HTTP 500');
    expect(auditoria.registrar).not.toHaveBeenCalled();
    await expect(processor.process(job(4))).rejects.toThrow('HTTP 500');
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ acao: 'WEBHOOK_FALHOU', nivel: 'ALERTA' }),
    );
  });

  it('não deve enviar para webhook desativado', async () => {
    const buscar = jest.spyOn(globalThis, 'fetch');
    const { processor } = montar(false);
    await expect(processor.process(job())).resolves.toBe(0);
    expect(buscar).not.toHaveBeenCalled();
  });
});
