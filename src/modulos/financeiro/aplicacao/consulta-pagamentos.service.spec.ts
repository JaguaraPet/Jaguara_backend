import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import type { FilaEmailService } from '../../notificacao/aplicacao/fila-email.service';
import {
  intervaloDoFiltro,
  motivoSemReembolso,
} from '../dominio/consulta-pagamentos';
import { ConsultaPagamentosService } from './consulta-pagamentos.service';

describe('ConsultaPagamentosService (UC-45, RN39)', () => {
  const ana = {
    sub: 'ana',
    tipo: 'TUTOR',
    permissoes: [],
  } as unknown as UsuarioAutenticado;
  const empresa = {
    sub: 'e1',
    tipo: 'EMPRESA',
    empresaId: 'e1',
    permissoes: ['financeiro:ler'],
  } as unknown as UsuarioAutenticado;
  const pagamento = (extra: object = {}) => ({
    id: 'pg1',
    codigoTransacao: 'tx',
    valor: { toNumber: () => 60, toFixed: () => '60.00' },
    dataHora: new Date(),
    metodo: 'PIX',
    status: 'ACEITO',
    dataConfirmacao: new Date(),
    agendamentoId: 'a1',
    assinaturaId: null,
    recebedorId: 'e1',
    agendamento: { servico: { nome: 'Banho' }, pet: { nome: 'Thor' } },
    recebedor: { nomeFantasia: 'Patas' },
    pagador: { nome: 'Ana' },
    solicitacaoReembolso: [],
    ...extra,
  });
  const montar = (p = pagamento()) => {
    const prisma = {
      pagamento: {
        findMany: jest.fn().mockResolvedValue([p]),
        findFirst: jest.fn().mockResolvedValue(p),
      },
      solicitacaoReembolso: { create: jest.fn() },
      usuario: {
        findUnique: jest.fn().mockResolvedValue({ email: 'e@x.com' }),
      },
    };
    const fila = { enviar: jest.fn() };
    return {
      prisma,
      fila,
      servico: new ConsultaPagamentosService(
        prisma as unknown as PrismaService,
        fila as unknown as FilaEmailService,
      ),
    };
  };
  const codigo = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: ErroNegocio) => e.codigo,
    );

  it('deve aplicar as regras do reembolso e o filtro de período', () => {
    const agora = new Date('2026-11-25T12:00:00Z');
    const ok = { status: 'ACEITO', dataConfirmacao: agora, reembolsos: [] };
    expect(motivoSemReembolso(ok, agora)).toBeNull();
    expect(motivoSemReembolso({ ...ok, status: 'PENDENTE' }, agora)).toMatch(
      /confirmado/,
    );
    expect(
      motivoSemReembolso(
        { ...ok, reembolsos: [{ status: 'EM_ANALISE' }] },
        agora,
      ),
    ).toMatch(/Já existe/);
    expect(
      motivoSemReembolso(
        { ...ok, dataConfirmacao: new Date('2026-09-01T12:00:00Z') },
        agora,
      ),
    ).toMatch(/prazo/);
    expect(intervaloDoFiltro()).toBeUndefined();
    expect(intervaloDoFiltro('2026-11-01', '2026-11-30')).toEqual({
      gte: new Date('2026-11-01T03:00:00.000Z'),
      lt: new Date('2026-12-01T03:00:00.000Z'),
    });
  });

  it('CT-45-01: deve listar pelo dono e montar o detalhe', async () => {
    const { prisma, servico } = montar();
    const [p] = await servico.listar(ana, { status: 'ACEITO' });
    expect(p).toMatchObject({
      descricao: 'Banho',
      contraparte: 'Patas',
      podeReembolsar: true,
    });
    expect(prisma.pagamento.findMany.mock.calls[0]).toMatchObject([
      { where: { pagadorId: 'ana', status: 'ACEITO' } },
    ]);
    const [recebido] = await servico.listar(empresa, {});
    expect(recebido).toMatchObject({
      contraparte: 'Ana',
      podeReembolsar: false,
    });
    expect(
      await codigo(servico.listar({ ...empresa, permissoes: [] }, {})),
    ).toBe('SEM_PERMISSAO');
  });

  it('deve registrar o reembolso e avisar a empresa', async () => {
    const { prisma, fila, servico } = montar();
    await servico.solicitarReembolso(ana, 'pg1', 'O banho foi cancelado');
    expect(prisma.solicitacaoReembolso.create.mock.calls[0]).toMatchObject([
      { data: { status: 'EM_ANALISE', motivo: 'O banho foi cancelado' } },
    ]);
    expect(fila.enviar).toHaveBeenCalledWith(
      'NOTIFICACAO',
      'e@x.com',
      expect.objectContaining({ titulo: 'Pedido de reembolso' }),
    );
  });

  it('CT-45-02: deve recusar o reembolso do pendente e motivo curto', async () => {
    const pendente = montar(
      pagamento({ status: 'PENDENTE', dataConfirmacao: null }),
    );
    expect(
      await codigo(
        pendente.servico.solicitarReembolso(ana, 'pg1', 'Quero meu dinheiro'),
      ),
    ).toBe('RN39_REEMBOLSO_INDISPONIVEL');
    expect(
      await codigo(pendente.servico.solicitarReembolso(ana, 'pg1', 'curto')),
    ).toBe('DADOS_INVALIDOS');
    expect(
      await codigo(
        pendente.servico.solicitarReembolso(
          empresa,
          'pg1',
          'Motivo qualquer longo',
        ),
      ),
    ).toBe('SEM_PERMISSAO');
  });
});
