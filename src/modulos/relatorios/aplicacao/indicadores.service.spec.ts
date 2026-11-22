import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { IndicadoresService } from './indicadores.service';

describe('IndicadoresService (UC-17, RN21)', () => {
  const dono = {
    sub: 'e1',
    tipo: 'EMPRESA',
    empresaId: 'e1',
    permissoes: ['relatorio:ler'],
  } as UsuarioAutenticado;
  const solicitacao = (status: string, servico: string) => ({
    status,
    servico: { nome: servico },
  });
  const montar = () => {
    const prisma = {
      agendamento: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { dataHoraInicio: new Date('2026-11-02T13:00:00Z') },
            { dataHoraInicio: new Date('2026-11-02T18:00:00Z') },
            { dataHoraInicio: new Date('2026-11-04T02:00:00Z') },
          ]),
      },
      pagamento: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { valor: { toNumber: () => 60.1 } },
            { valor: { toNumber: () => 59.9 } },
          ]),
      },
      solicitacaoServico: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            solicitacao('ACEITA', 'Banho'),
            solicitacao('CONCLUIDA', 'Banho'),
            solicitacao('RECUSADA', 'Consulta'),
            solicitacao('PENDENTE', 'Banho'),
          ]),
      },
    };
    return new IndicadoresService(prisma as unknown as PrismaService);
  };
  const codigo = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: ErroNegocio) => e.codigo,
    );

  it('CT-17-01: deve calcular os indicadores da empresa no período', async () => {
    const r = await montar().consultar(dono, 'e1', {
      de: '2026-11-01',
      ate: '2026-11-04',
    });
    expect(r).toMatchObject({
      atendimentos: 3,
      faturamento: 120,
      taxaAceite: 66.7,
      solicitacoes: 4,
      servicosMaisSolicitados: [
        { servico: 'Banho', quantidade: 3 },
        { servico: 'Consulta', quantidade: 1 },
      ],
    });
    expect(r.atendimentosPorDia).toEqual([
      { data: '2026-11-01', quantidade: 0 },
      { data: '2026-11-02', quantidade: 2 },
      { data: '2026-11-03', quantidade: 1 },
      { data: '2026-11-04', quantidade: 0 },
    ]);
  });

  it('CT-17-02: deve bloquear os indicadores de outra empresa e período inválido', async () => {
    const servico = montar();
    const periodo = { de: '2026-11-01', ate: '2026-11-30' };
    expect(await codigo(servico.consultar(dono, 'e2', periodo))).toBe(
      'SEM_PERMISSAO',
    );
    const admin = {
      ...dono,
      tipo: 'ADMINISTRADOR',
      empresaId: null,
    } as UsuarioAutenticado;
    expect(await codigo(servico.consultar(admin, 'e1', periodo))).toBe(
      'SEM_PERMISSAO',
    );
    expect(
      await codigo(
        servico.consultar(dono, 'e1', { de: '2025-01-01', ate: '2026-11-30' }),
      ),
    ).toBe('DADOS_INVALIDOS');
    expect(
      await codigo(
        servico.consultar(dono, 'e1', { de: '2026-12-01', ate: '2026-11-30' }),
      ),
    ).toBe('DADOS_INVALIDOS');
  });
});
