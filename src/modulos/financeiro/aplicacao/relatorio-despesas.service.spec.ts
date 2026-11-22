import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { reais, totaisPorCategoria } from '../dominio/relatorio-despesas';
import type { DespesasService } from './despesas.service';
import { RelatorioDespesasService } from './relatorio-despesas.service';

describe('RelatorioDespesasService (UC-07, RN11)', () => {
  const ana = { sub: 'ana' } as UsuarioAutenticado;
  const registro = (valor: number, categoria: string, data: string) => ({
    descricao: `Gasto ${categoria}`,
    valor: { toNumber: () => valor },
    data: new Date(data),
    categoria: { nome: categoria },
    pet: { nome: 'Thor' },
  });
  const montar = (registros: unknown[]) => {
    const prisma = {
      despesa: { findMany: jest.fn().mockResolvedValue(registros) },
      relatorio: { create: jest.fn().mockResolvedValue({}) },
    };
    const despesas = { garantirResponsavel: jest.fn() };
    return {
      prisma,
      despesas,
      servico: new RelatorioDespesasService(
        prisma as unknown as PrismaService,
        despesas as unknown as DespesasService,
      ),
    };
  };
  const filtro = { petId: 'p1', de: '2026-11-01', ate: '2026-11-30' };

  it('deve somar por categoria sem erro de arredondamento', () => {
    const totais = totaisPorCategoria([
      { descricao: 'a', valor: 0.1, data: '', categoria: 'Saúde', pet: '' },
      { descricao: 'b', valor: 0.2, data: '', categoria: 'Saúde', pet: '' },
      { descricao: 'c', valor: 1, data: '', categoria: 'Outros', pet: '' },
    ]);
    expect(totais).toEqual([
      { categoria: 'Outros', quantidade: 1, total: 1 },
      { categoria: 'Saúde', quantidade: 2, total: 0.3 },
    ]);
    expect(reais(1234.5)).toBe('R$ 1.234,50');
  });

  it('CT-07-01: deve gerar o relatório, registrá-lo e exportar em PDF', async () => {
    const { prisma, despesas, servico } = montar([
      registro(189.9, 'Alimentação', '2026-11-10'),
      registro(80, 'Saúde', '2026-11-12'),
    ]);
    const r = await servico.gerar(ana, filtro, 'TELA');
    expect(r.total).toBe(269.9);
    expect(r.porCategoria[0]).toEqual({
      categoria: 'Alimentação',
      quantidade: 1,
      total: 189.9,
    });
    expect(despesas.garantirResponsavel).toHaveBeenCalledWith(ana, 'p1');
    expect(prisma.relatorio.create.mock.calls[0]).toMatchObject([
      { data: { tipo: 'DESPESAS', formato: 'TELA' } },
    ]);
    const pdf = await servico.pdf(ana, filtro);
    expect(pdf.toString('latin1')).toContain('(Total: R$ 269,90) Tj');
  });

  it('CT-07-02: deve avisar quando não há despesas e validar o período', async () => {
    const { servico } = montar([]);
    await expect(servico.gerar(ana, filtro, 'TELA')).rejects.toMatchObject({
      codigo: 'RN11_SEM_DADOS',
    });
    const erro = await servico
      .gerar(ana, { de: '2026-12-01', ate: '2026-11-01' }, 'TELA')
      .catch((e: ErroNegocio) => e);
    expect((erro as ErroNegocio).codigo).toBe('DADOS_INVALIDOS');
  });
});
