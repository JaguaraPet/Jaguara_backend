import { mantemPrincipal, podeAlterarVinculo } from './responsaveis';

describe('responsáveis pelo pet (UC-05, RN09)', () => {
  const ana = { tutorId: 'ana', tipo: 'PRINCIPAL' as const };
  const caio = { tutorId: 'caio', tipo: 'ADICIONAL' as const };

  it('CT-05-02: não deve deixar o pet sem responsável principal', () => {
    expect(
      mantemPrincipal([ana, caio], { tutorId: 'ana', novoTipo: null }),
    ).toBe(false);
    expect(
      mantemPrincipal([ana, caio], { tutorId: 'ana', novoTipo: 'ADICIONAL' }),
    ).toBe(false);
    expect(
      mantemPrincipal([ana, caio], { tutorId: 'caio', novoTipo: null }),
    ).toBe(true);
    expect(
      mantemPrincipal([ana, { ...caio, tipo: 'PRINCIPAL' }], {
        tutorId: 'ana',
        novoTipo: null,
      }),
    ).toBe(true);
  });

  it('deve deixar o principal gerenciar e o adicional só sair', () => {
    expect(podeAlterarVinculo(ana, 'caio', 'remover')).toBe(true);
    expect(podeAlterarVinculo(ana, 'caio', 'mudarTipo')).toBe(true);
    expect(podeAlterarVinculo(caio, 'caio', 'remover')).toBe(true);
    expect(podeAlterarVinculo(caio, 'ana', 'remover')).toBe(false);
    expect(podeAlterarVinculo(caio, '', 'adicionar')).toBe(false);
  });
});
