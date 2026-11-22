import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import {
  agrupar,
  percentual,
  permissoesFaltando,
} from '../dominio/relatorio-empresa';
import { RelatoriosEmpresaService } from './relatorios-empresa.service';

describe('RelatoriosEmpresaService (UC-18, RN22)', () => {
  const dono = {
    sub: 'e1',
    tipo: 'EMPRESA',
    empresaId: 'e1',
    permissoes: ['relatorio:ler', 'financeiro:ler'],
  } as UsuarioAutenticado;
  const periodo = { de: '2026-11-01', ate: '2026-11-30' };
  const agendamento = (status: string, servico: string, prof?: string) => ({
    dataHoraInicio: new Date('2026-11-10T13:00:00Z'),
    status,
    servico: { nome: servico },
    pet: { nome: 'Thor' },
    profissional: prof ? { nome: prof } : null,
    atendimento: status === 'REALIZADO' ? { status: 'FINALIZADO' } : null,
  });
  const pagamento = (status: string, valor: number, metodo = 'PIX') => ({
    status,
    metodo,
    valor: { toNumber: () => valor },
    agendamento: { servico: { nome: 'Banho' } },
  });
  const montar = () => {
    const prisma = {
      agendamento: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            agendamento('REALIZADO', 'Banho', 'Júlia'),
            agendamento('REALIZADO', 'Banho', 'Júlia'),
            agendamento('NAO_COMPARECEU', 'Consulta', 'Júlia'),
            agendamento('CANCELADO', 'Consulta'),
          ]),
      },
      pagamento: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            pagamento('ACEITO', 60.1),
            pagamento('ACEITO', 59.9, 'CARTAO_CREDITO'),
            pagamento('PENDENTE', 80),
          ]),
      },
      relatorio: { create: jest.fn() },
    };
    return {
      prisma,
      servico: new RelatoriosEmpresaService(prisma as unknown as PrismaService),
    };
  };
  const codigo = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: ErroNegocio) => e.codigo,
    );

  it('deve agrupar, calcular percentuais e conferir permissões', () => {
    expect(agrupar(['a', 'b', 'a'], (x) => x)).toEqual([
      { chave: 'a', quantidade: 2 },
      { chave: 'b', quantidade: 1 },
    ]);
    expect(percentual(2, 3)).toBe(66.7);
    expect(percentual(0, 0)).toBe(0);
    expect(permissoesFaltando('financeiro', ['relatorio:ler'])).toEqual([
      'financeiro:ler',
    ]);
  });

  it('CT-18-01: deve gerar o relatório de atendimentos do mês', async () => {
    const { prisma, servico } = montar();
    const r = await servico.gerar(dono, 'e1', 'atendimentos', periodo, 'TELA');
    expect(r).toMatchObject({
      total: 4,
      taxaComparecimento: 66.7,
      porServico: [
        { chave: 'Banho', quantidade: 2 },
        { chave: 'Consulta', quantidade: 2 },
      ],
    });
    expect(prisma.relatorio.create.mock.calls[0]).toMatchObject([
      { data: { tipo: 'OPERACIONAL', formato: 'TELA' } },
    ]);
  });

  it('deve gerar o financeiro e exportar em PDF', async () => {
    const { servico } = montar();
    const r = await servico.gerar(dono, 'e1', 'financeiro', periodo, 'TELA');
    expect(r).toMatchObject({
      faturamento: 120,
      pagamentosConfirmados: 2,
      ticketMedio: 60,
      pendentes: { quantidade: 1, total: 80 },
    });
    const pdf = await servico.pdf(dono, 'e1', 'atendimentos', periodo);
    expect(pdf.toString('latin1')).toContain('(Comparecimento: 66.7%) Tj');
  });

  it('CT-18-02: deve bloquear sem permissão, outra empresa e período invertido', async () => {
    const { servico } = montar();
    const semFinanceiro = { ...dono, permissoes: ['relatorio:ler'] };
    expect(
      await codigo(
        servico.gerar(semFinanceiro, 'e1', 'financeiro', periodo, 'TELA'),
      ),
    ).toBe('SEM_PERMISSAO');
    expect(
      await codigo(servico.gerar(dono, 'e2', 'atendimentos', periodo, 'TELA')),
    ).toBe('SEM_PERMISSAO');
    expect(
      await codigo(
        servico.gerar(
          dono,
          'e1',
          'atendimentos',
          { de: '2026-12-01', ate: '2026-11-01' },
          'TELA',
        ),
      ),
    ).toBe('DADOS_INVALIDOS');
  });
});
