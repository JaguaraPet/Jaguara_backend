import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import type { PublicadorWebhook } from '../../../compartilhado/webhooks/publicador-webhook';
import type { FilaEmailService } from '../../notificacao/aplicacao/fila-email.service';
import {
  autorDaMudanca,
  motivoParaNaoCancelar,
} from '../dominio/acompanhamento';
import { AcompanhamentoSolicitacoesService } from './acompanhamento-solicitacoes.service';

describe('AcompanhamentoSolicitacoesService (UC-42, RN38)', () => {
  const ana = { sub: 'ana', tipo: 'TUTOR' } as UsuarioAutenticado;
  const futuro = new Date(Date.now() + 86_400_000);
  const solicitacao = (extra: object = {}) => ({
    id: 's1',
    tutorId: 'ana',
    status: 'PENDENTE',
    dataHoraDesejada: futuro,
    observacoes: null,
    motivoRecusa: null,
    servico: {
      id: 'sv1',
      nome: 'Banho',
      preco: { toNumber: () => 60 },
      duracaoMinutos: 60,
      empresa: { id: 'e1', nomeFantasia: 'Patas' },
    },
    pet: { id: 'p1', nome: 'Thor' },
    agendamento: null,
    historicoSolicitacao: [
      {
        dataHora: new Date(),
        statusAnterior: null,
        statusNovo: 'PENDENTE',
        autorId: 'ana',
        descricao: null,
      },
    ],
    ...extra,
  });
  const montar = (s = solicitacao(), mudou = 1) => {
    const tx = {
      solicitacaoServico: {
        updateMany: jest.fn().mockResolvedValue({ count: mudou }),
      },
      agendamento: { update: jest.fn() },
      historicoSolicitacao: { create: jest.fn() },
    };
    const prisma = {
      solicitacaoServico: {
        findMany: jest.fn().mockResolvedValue([s]),
        findUnique: jest.fn().mockResolvedValue(s),
      },
      usuario: {
        findUnique: jest.fn().mockResolvedValue({ email: 'e@x.com' }),
      },
      tutor: { findUnique: jest.fn().mockResolvedValue({ nome: 'Ana' }) },
      $transaction: jest.fn((f: (t: typeof tx) => Promise<void>) => f(tx)),
    };
    const fila = { enviar: jest.fn() };
    const webhooks = { publicar: jest.fn() };
    return {
      tx,
      fila,
      webhooks,
      servico: new AcompanhamentoSolicitacoesService(
        prisma as unknown as PrismaService,
        fila as unknown as FilaEmailService,
        webhooks as unknown as PublicadorWebhook,
      ),
    };
  };
  const codigo = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: ErroNegocio) => e.codigo,
    );

  it('deve aplicar as regras de cancelamento', () => {
    const agora = new Date('2026-11-24T12:00:00Z');
    const depois = new Date('2026-11-25T12:00:00Z');
    expect(
      motivoParaNaoCancelar({ status: 'ACEITA', horario: depois }, agora),
    ).toBeNull();
    expect(
      motivoParaNaoCancelar({ status: 'ACEITA', horario: agora }, agora),
    ).toMatch(/já passou/);
    expect(
      motivoParaNaoCancelar({ status: 'RECUSADA', horario: depois }, agora),
    ).toMatch(/pendentes ou aceitas/);
    expect(autorDaMudanca('ana', 'ana', 'Patas')).toBe('Você');
    expect(autorDaMudanca('e1', 'ana', 'Patas')).toBe('Patas');
  });

  it('CT-42-01: deve detalhar com o histórico e a opção de cancelar', async () => {
    const { servico } = montar();
    const d = await servico.detalhar(ana, 's1');
    expect(d).toMatchObject({
      podeCancelar: true,
      empresa: { nome: 'Patas' },
      historico: [{ statusNovo: 'PENDENTE', autor: 'Você' }],
    });
    await expect(servico.listar(ana)).resolves.toHaveLength(1);
    expect(await codigo(servico.detalhar({ ...ana, sub: 'bia' }, 's1'))).toBe(
      'NAO_ENCONTRADO',
    );
    expect(
      await codigo(servico.detalhar({ ...ana, tipo: 'EMPRESA' }, 's1')),
    ).toBe('SEM_PERMISSAO');
  });

  it('deve cancelar a aceita desfazendo o agendamento e avisando a empresa', async () => {
    const { tx, fila, webhooks, servico } = montar(
      solicitacao({
        status: 'ACEITA',
        agendamento: {
          id: 'a1',
          status: 'AGENDADO',
          dataHoraInicio: futuro,
          precoContratado: { toNumber: () => 60 },
          pagamento: [],
        },
      }),
    );
    await servico.cancelar(ana, 's1');
    expect(tx.agendamento.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { status: 'CANCELADO' },
    });
    expect(tx.historicoSolicitacao.create.mock.calls[0]).toMatchObject([
      { data: { statusNovo: 'CANCELADA', autorId: 'ana' } },
    ]);
    expect(webhooks.publicar).toHaveBeenCalledTimes(2);
    expect(fila.enviar).toHaveBeenCalledWith(
      'SOLICITACAO_CANCELADA',
      'e@x.com',
      expect.objectContaining({ agendamentoDesfeito: true }),
    );
  });

  it('CT-42-02: deve bloquear depois do horário e na corrida de status', async () => {
    const passada = montar(
      solicitacao({ dataHoraDesejada: new Date(Date.now() - 1000) }),
    );
    expect(await codigo(passada.servico.cancelar(ana, 's1'))).toBe(
      'RN38_CANCELAMENTO_BLOQUEADO',
    );
    const corrida = montar(solicitacao(), 0);
    expect(await codigo(corrida.servico.cancelar(ana, 's1'))).toBe(
      'RN38_CANCELAMENTO_BLOQUEADO',
    );
  });
});
