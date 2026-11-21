import type { PublicadorWebhook } from '../../../compartilhado/webhooks/publicador-webhook';
import type { AuditoriaService } from '../../../compartilhado/auditoria/auditoria.service';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { AtendimentosService } from './atendimentos.service';

describe('AtendimentosService (UC-23)', () => {
  const empresa: UsuarioAutenticado = {
    sub: 'u1',
    sid: 's1',
    tipo: 'EMPRESA',
    perfil: 'Empresa',
    empresaId: 'e1',
    permissoes: ['atendimento:editar'],
  };
  const decimal = (v: number) => ({ toNumber: () => v });
  const agendamento = {
    id: 'a1',
    servicoId: 'banho',
    petId: 'p1',
    profissionalId: null,
    status: 'AGENDADO',
    precoContratado: decimal(60),
    dataHoraInicio: new Date(Date.now() - 3_600_000),
    servico: { empresaId: 'e1' },
    atendimento: null,
  };
  const gravado = {
    id: 'at1',
    agendamentoId: 'a1',
    petId: 'p1',
    status: 'FINALIZADO' as const,
    procedimentosRealizados: 'Banho',
    observacoesClinicas: null,
    finalizadoEm: new Date('2026-11-21T15:00:00Z'),
    itemAtendimento: [
      {
        servicoId: 'banho',
        quantidade: 1,
        valorUnitario: decimal(60),
        observacao: null,
      },
    ],
    agendamento: { servico: { empresaId: 'e1' } },
  };

  const montar = () => {
    const prisma = {
      agendamento: {
        findUnique: jest.fn().mockResolvedValue(agendamento),
        update: jest.fn().mockResolvedValue(agendamento),
      },
      servico: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'banho', empresaId: 'e1', preco: decimal(70) },
          { id: 'outra', empresaId: 'e2', preco: decimal(10) },
        ]),
      },
      atendimento: {
        create: jest.fn().mockResolvedValue(gravado),
        findUnique: jest.fn().mockResolvedValue(gravado),
        update: jest.fn().mockResolvedValue({
          ...gravado,
          observacoesClinicas: 'Otite',
        }),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
    const servico = new AtendimentosService(
      prisma as unknown as PrismaService,
      auditoria as unknown as AuditoriaService,
      { publicar: jest.fn() } as unknown as PublicadorWebhook,
    );
    return { prisma, auditoria, servico };
  };

  const codigo = async (promessa: Promise<unknown>) => {
    try {
      await promessa;
    } catch (erro) {
      return (erro as ErroNegocio).codigo;
    }
    return 'SEM_ERRO';
  };

  it('CT-23-01: deve gravar o item agendado pelo preço contratado', async () => {
    const { prisma, servico } = montar();
    const atendimento = await servico.registrar(empresa, 'a1', {
      procedimentosRealizados: ' Banho ',
      itens: [{ servicoId: 'banho', quantidade: 1 }],
    });
    const dados = (
      prisma.atendimento.create.mock.calls[0] as [
        { data: { itemAtendimento: { create: { valorUnitario: number }[] } } },
      ]
    )[0].data;
    expect(dados.itemAtendimento.create[0].valorUnitario).toBe(60);
    expect(atendimento.total).toBe(60);
  });

  it('deve recusar serviço de outra empresa, registro repetido e agendamento inativo', async () => {
    const { prisma, servico } = montar();
    const corpo = {
      procedimentosRealizados: 'Banho',
      itens: [{ servicoId: 'outra', quantidade: 1 }],
    };
    expect(await codigo(servico.registrar(empresa, 'a1', corpo))).toBe(
      'DADOS_INVALIDOS',
    );
    prisma.agendamento.findUnique.mockResolvedValueOnce({
      ...agendamento,
      atendimento: { id: 'x' },
    });
    expect(await codigo(servico.registrar(empresa, 'a1', corpo))).toBe(
      'ATENDIMENTO_JA_REGISTRADO',
    );
    prisma.agendamento.findUnique.mockResolvedValueOnce({
      ...agendamento,
      status: 'CANCELADO',
    });
    expect(await codigo(servico.registrar(empresa, 'a1', corpo))).toBe(
      'AGENDAMENTO_INATIVO',
    );
    prisma.agendamento.findUnique.mockResolvedValueOnce(null);
    expect(await codigo(servico.registrar(empresa, 'a1', corpo))).toBe(
      'NAO_ENCONTRADO',
    );
  });

  it('CT-23-02: deve auditar a alteração como CRITICO e recusar alteração vazia', async () => {
    const { auditoria, servico } = montar();
    await servico.alterar(empresa, 'at1', {
      observacoesClinicas: 'Otite',
      justificativa: 'Faltou registrar',
    });
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        acao: 'ATENDIMENTO_ALTERADO',
        nivel: 'CRITICO',
        autorId: 'u1',
      }),
    );
    expect(
      await codigo(
        servico.alterar(empresa, 'at1', {
          procedimentosRealizados: 'Banho',
          justificativa: 'Sem mudança nenhuma',
        }),
      ),
    ).toBe('DADOS_INVALIDOS');
    await expect(servico.doAgendamento(empresa, 'a1')).resolves.toMatchObject({
      id: 'at1',
    });
  });
});
