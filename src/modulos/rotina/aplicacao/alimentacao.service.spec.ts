import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import type { PoliticaAcessoPet } from '../../pet/aplicacao/politica-acesso-pet';
import { AlimentacaoService } from './alimentacao.service';

describe('AlimentacaoService (UC-08, RN12)', () => {
  const tutor = { sub: 't1', tipo: 'TUTOR' } as UsuarioAutenticado;
  const decimal = (v: number) => ({ toNumber: () => v });
  const plano = {
    id: 'pl1',
    alimento: 'Ração',
    metaDiariaGramas: decimal(250),
    limiteDiarioGramas: decimal(300),
    refeicoesPorDia: 2,
    dataInicio: new Date('2026-11-21'),
  };
  const refeicao = (g: number) => ({
    id: `r${g}`,
    dataHora: new Date(),
    alimento: 'Ração',
    quantidadeGramas: decimal(g),
    observacao: null,
  });

  const montar = (nivel = 'RESPONSAVEL_PRINCIPAL') => {
    const prisma = {
      planoAlimentar: {
        findFirst: jest.fn().mockResolvedValue(plano),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue(plano),
      },
      registroAlimentacao: {
        create: jest.fn().mockResolvedValue(refeicao(100)),
        findMany: jest.fn().mockResolvedValue([refeicao(250), refeicao(100)]),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    const servico = new AlimentacaoService(
      prisma as unknown as PrismaService,
      {
        nivel: jest.fn().mockResolvedValue(nivel),
      } as unknown as PoliticaAcessoPet,
    );
    return { prisma, servico };
  };

  const codigo = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return (e as ErroNegocio).codigo;
    }
    return 'SEM_ERRO';
  };

  it('CT-08-02: deve registrar e alertar o limite excedido', async () => {
    const { servico } = montar();
    await expect(
      servico.registrarRefeicao(tutor, 'p1', {
        dataHora: new Date().toISOString(),
        alimento: 'Ração',
        quantidadeGramas: 100,
      }),
    ).resolves.toMatchObject({ consumoDoDia: 350, limiteExcedido: true });
  });

  it('deve trocar o plano ativo e recusar limite menor que a meta', async () => {
    const { prisma, servico } = montar();
    await servico.definirPlano(tutor, 'p1', {
      alimento: 'Ração',
      metaDiariaGramas: 250,
      limiteDiarioGramas: 300,
      refeicoesPorDia: 2,
    });
    expect(prisma.planoAlimentar.updateMany).toHaveBeenCalled();
    expect(
      await codigo(
        servico.definirPlano(tutor, 'p1', {
          alimento: 'Ração',
          metaDiariaGramas: 250,
          limiteDiarioGramas: 100,
          refeicoesPorDia: 2,
        }),
      ),
    ).toBe('DADOS_INVALIDOS');
    await expect(servico.plano(tutor, 'p1')).resolves.toMatchObject({
      metaDiariaGramas: 250,
    });
  });

  it('deve resumir o dia, recusar refeição futura e esconder o pet de quem não é responsável', async () => {
    const { servico } = montar();
    await expect(
      servico.refeicoesDoDia(tutor, 'p1', '2026-11-21'),
    ).resolves.toMatchObject({ data: '2026-11-21', consumoDoDia: 350 });
    expect(
      await codigo(
        servico.registrarRefeicao(tutor, 'p1', {
          dataHora: new Date(Date.now() + 3_600_000).toISOString(),
          alimento: 'Ração',
          quantidadeGramas: 10,
        }),
      ),
    ).toBe('DADOS_INVALIDOS');
    expect(await codigo(montar('NENHUM').servico.plano(tutor, 'p1'))).toBe(
      'NAO_ENCONTRADO',
    );
  });
});
