import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { motivoRecusa, tipoDaConta } from '../dominio/conta-usuario';
import { ContasService } from './contas.service';

describe('ContasService (UC-28, RN34)', () => {
  const admin = { sub: 'adm' } as UsuarioAutenticado;
  const conta = {
    id: 'u1',
    email: 'ana@exemplo.com',
    status: 'ATIVA',
    emailConfirmado: true,
    dataCadastro: new Date('2026-11-01T10:00:00Z'),
    tutor: { nome: 'Ana' },
    empresaEnterprise: null,
    funcionarioEnterprise: null,
    administrador: null,
    _count: { sessao: 2 },
  };
  const montar = (falhaAuditoria = false) => {
    const tx = {
      usuario: { update: jest.fn() },
      sessao: { deleteMany: jest.fn() },
      logAuditoria: {
        create: falhaAuditoria
          ? jest.fn().mockRejectedValue(new Error('auditoria fora'))
          : jest.fn(),
      },
    };
    const prisma = {
      usuario: {
        findMany: jest.fn().mockResolvedValue([conta]),
        findUnique: jest.fn().mockResolvedValue(conta),
      },
      logAuditoria: {
        findMany: jest.fn().mockResolvedValue([
          {
            dataHora: new Date('2026-11-02T10:00:00Z'),
            acao: 'CONTA_SUSPENSA',
            autorId: 'adm',
            detalhes: 'Denúncia de spam',
          },
        ]),
      },
      $transaction: jest.fn((f: (t: typeof tx) => Promise<void>) => f(tx)),
    };
    return {
      tx,
      servico: new ContasService(prisma as unknown as PrismaService),
    };
  };
  const erro = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: ErroNegocio) => e.codigo,
    );

  it('deve aplicar as regras de mudança de status', () => {
    expect(
      motivoRecusa({ atual: 'ATIVA', novo: 'SUSPENSA', propriaConta: false }),
    ).toBeNull();
    expect(
      motivoRecusa({ atual: 'ATIVA', novo: 'ATIVA', propriaConta: false }),
    ).toMatch(/já está/);
    expect(
      motivoRecusa({ atual: 'INATIVA', novo: 'ATIVA', propriaConta: false }),
    ).not.toBeNull();
    expect(
      motivoRecusa({ atual: 'ATIVA', novo: 'BLOQUEADA', propriaConta: true }),
    ).not.toBeNull();
    expect(
      tipoDaConta({
        tutor: null,
        empresaEnterprise: {},
        funcionarioEnterprise: null,
        administrador: null,
      }),
    ).toBe('EMPRESA');
  });

  it('deve listar e detalhar a conta com o histórico', async () => {
    const { servico } = montar();
    await expect(servico.listar({ busca: 'ana' })).resolves.toEqual([
      expect.objectContaining({ nome: 'Ana', tipo: 'TUTOR' }),
    ]);
    const detalhe = await servico.detalhar('u1');
    expect(detalhe.sessoesAtivas).toBe(2);
    expect(detalhe.historico[0]).toMatchObject({
      acao: 'CONTA_SUSPENSA',
      motivo: 'Denúncia de spam',
    });
  });

  it('CT-28-01: deve suspender, encerrar as sessões e auditar', async () => {
    const { tx, servico } = montar();
    await servico.alterarStatus(admin, 'u1', {
      status: 'SUSPENSA',
      motivo: 'Denúncia de spam',
    });
    expect(tx.usuario.update.mock.calls[0]).toMatchObject([
      { data: { status: 'SUSPENSA' } },
    ]);
    expect(tx.sessao.deleteMany).toHaveBeenCalled();
    expect(tx.logAuditoria.create.mock.calls[0]).toMatchObject([
      { data: { acao: 'CONTA_SUSPENSA', autorId: 'adm', nivel: 'ALERTA' } },
    ]);
  });

  it('CT-28-02: deve cancelar a operação quando a auditoria falha', async () => {
    const { servico } = montar(true);
    expect(
      await erro(
        servico.alterarStatus(admin, 'u1', {
          status: 'BLOQUEADA',
          motivo: 'Fraude no pagamento',
        }),
      ),
    ).toBe('RN34_AUDITORIA_INDISPONIVEL');
    expect(
      await erro(
        servico.alterarStatus(admin, 'u1', {
          status: 'ATIVA',
          motivo: 'xxxxx',
        }),
      ),
    ).toBe('RN34_STATUS_INVALIDO');
  });
});
