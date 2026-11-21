import { CATEGORIAS_PADRAO, totaisPorCategoria, valorValido } from './despesa';

describe('despesas (UC-06, RN10)', () => {
  it('deve ter categorias padrão com nomes únicos', () => {
    const nomes = CATEGORIAS_PADRAO.map((c) => c.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
    expect(nomes).toContain('Outros');
  });

  it('deve aceitar só valores positivos com até duas casas', () => {
    expect(valorValido(89.9)).toBe(true);
    expect(valorValido(0.01)).toBe(true);
    expect(valorValido(0)).toBe(false);
    expect(valorValido(-5)).toBe(false);
    expect(valorValido(10.555)).toBe(false);
    expect(valorValido(Number.NaN)).toBe(false);
    expect(valorValido(2_000_000)).toBe(false);
  });

  it('deve somar por categoria sem erro de arredondamento', () => {
    expect(
      totaisPorCategoria([
        { categoria: 'Saúde', valor: 0.1 },
        { categoria: 'Saúde', valor: 0.2 },
        { categoria: 'Alimentação', valor: 150 },
        { categoria: 'Acessórios', valor: 0.3 },
      ]),
    ).toEqual([
      { categoria: 'Alimentação', total: 150 },
      { categoria: 'Acessórios', total: 0.3 },
      { categoria: 'Saúde', total: 0.3 },
    ]);
  });
});
