import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import type { PoliticaAcessoPet } from '../../pet/aplicacao/politica-acesso-pet';
import { DespesasService } from './despesas.service';

describe('DespesasService (UC-06, RN10)', () => {
  const tutor = { sub: 't1', tipo: 'TUTOR' } as UsuarioAutenticado;
  const despesa = {
    id: 'd1',
    descricao: 'Ração',
    valor: { toNumber: () => 189.9 },
    data: new Date('2026-11-10'),
    categoriaId: 'c1',
    categoria: { nome: 'Alimentação' },
  };
  const montar = (nivel = 'RESPONSAVEL_PRINCIPAL') => {
    const prisma = {
      categoriaDespesa: {
        upsert: jest.fn().mockResolvedValue({}),
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'c1', nome: 'Alimentação', descricao: null },
          ]),
        findUnique: jest.fn().mockResolvedValue({ id: 'c1' }),
      },
      despesa: {
        findMany: jest.fn().mockResolvedValue([despesa]),
        create: jest.fn().mockResolvedValue(despesa),
      },
    };
    const servico = new DespesasService(
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

  it('deve garantir as categorias padrão e listá-las', async () => {
    const { prisma, servico } = montar();
    await servico.onApplicationBootstrap();
    expect(prisma.categoriaDespesa.upsert).toHaveBeenCalledTimes(8);
    await expect(servico.categorias()).resolves.toEqual([
      { id: 'c1', nome: 'Alimentação', descricao: undefined },
    ]);
  });

  it('CT-06-01 e CT-06-02: deve registrar com categoria e filtrar o histórico', async () => {
    const { prisma, servico } = montar();
    await expect(
      servico.registrar(tutor, 'p1', {
        descricao: 'Ração',
        valor: 189.9,
        data: '2026-11-10',
        categoriaId: 'c1',
      }),
    ).resolves.toMatchObject({ categoria: 'Alimentação', valor: 189.9 });
    await servico.listar(tutor, 'p1', {
      de: '2026-11-01',
      ate: '2026-11-30',
      categoriaId: 'c1',
    });
    expect(prisma.despesa.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ categoriaId: 'c1' }) as unknown,
      }),
    );
    prisma.categoriaDespesa.findUnique.mockResolvedValueOnce(null);
    const base = {
      descricao: 'x',
      valor: 10,
      data: '2026-11-10',
      categoriaId: 'zz',
    };
    expect(await codigo(servico.registrar(tutor, 'p1', base))).toBe(
      'DADOS_INVALIDOS',
    );
    expect(
      await codigo(servico.registrar(tutor, 'p1', { ...base, valor: 0 })),
    ).toBe('DADOS_INVALIDOS');
    expect(
      await codigo(
        servico.registrar(tutor, 'p1', { ...base, data: '2999-01-01' }),
      ),
    ).toBe('DADOS_INVALIDOS');
    expect(await codigo(montar('NENHUM').servico.listar(tutor, 'p1', {}))).toBe(
      'NAO_ENCONTRADO',
    );
  });
});
