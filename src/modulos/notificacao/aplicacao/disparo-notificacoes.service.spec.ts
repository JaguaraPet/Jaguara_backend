import type { AuditoriaService } from '../../../compartilhado/auditoria/auditoria.service';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { DisparoNotificacoesService } from './disparo-notificacoes.service';
import type { FilaEmailService } from './fila-email.service';

describe('DisparoNotificacoesService (DS-06)', () => {
  const agora = new Date('2026-11-21T12:00:00Z');
  const notificacao = (extra: object = {}) => ({
    id: 'n1',
    destinatarioId: 'u1',
    titulo: 'Hora do remédio de Thor',
    mensagem: 'Amoxicilina: 1 comprimido (Oral).',
    canal: 'PUSH',
    tentativas: 0,
    destinatario: { email: 'ana@exemplo.com' },
    ...extra,
  });

  const montar = (vencidas: object[]) => {
    const prisma = {
      notificacao: {
        findMany: jest.fn().mockResolvedValue(vencidas),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const fila = { enviar: jest.fn().mockResolvedValue(undefined) };
    const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
    const push = {
      nome: 'teste',
      enviar: jest.fn().mockResolvedValue(undefined),
    };
    const servico = new DisparoNotificacoesService(
      prisma as unknown as PrismaService,
      fila as unknown as FilaEmailService,
      auditoria as unknown as AuditoriaService,
      push,
    );
    return { prisma, fila, auditoria, push, servico };
  };

  it('deve enviar por push ou e-mail e marcar como enviada', async () => {
    const { prisma, fila, push, servico } = montar([
      notificacao(),
      notificacao({ id: 'n2', canal: 'EMAIL' }),
    ]);
    await expect(servico.disparar(agora)).resolves.toEqual({
      enviadas: 2,
      falhas: 0,
    });
    expect(push.enviar).toHaveBeenCalledWith(
      'u1',
      'Hora do remédio de Thor',
      'Amoxicilina: 1 comprimido (Oral).',
    );
    expect(fila.enviar).toHaveBeenCalledWith(
      'NOTIFICACAO',
      'ana@exemplo.com',
      expect.objectContaining({ titulo: 'Hora do remédio de Thor' }),
    );
    expect(prisma.notificacao.updateMany).toHaveBeenCalledTimes(2);
  });

  it('CT-31-02: deve registrar a falha e agendar nova tentativa', async () => {
    const { prisma, push, auditoria, servico } = montar([notificacao()]);
    push.enviar.mockRejectedValueOnce(new Error('push fora do ar'));
    await expect(servico.disparar(agora)).resolves.toEqual({
      enviadas: 0,
      falhas: 1,
    });
    expect(prisma.notificacao.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: {
        tentativas: 1,
        dataProgramada: new Date('2026-11-21T12:01:00Z'),
      },
    });
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('deve marcar como FALHOU e auditar na última tentativa', async () => {
    const { prisma, push, auditoria, servico } = montar([
      notificacao({ tentativas: 4 }),
    ]);
    push.enviar.mockRejectedValueOnce(new Error('push fora do ar'));
    await servico.disparar(agora);
    expect(prisma.notificacao.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { status: 'FALHOU', tentativas: 5 },
    });
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ acao: 'NOTIFICACAO_FALHOU', nivel: 'ALERTA' }),
    );
  });
});
