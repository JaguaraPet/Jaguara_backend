import {
  PERFIS_EMPRESA_PADRAO,
  PERFIS_GLOBAIS,
  PERMISSOES,
} from './catalogo-permissoes';

describe('Catálogo de permissões', () => {
  it('deve usar o formato recurso:acao em todos os códigos', () => {
    for (const codigo of Object.keys(PERMISSOES)) {
      expect(codigo).toMatch(/^[a-z_]+:[a-z_]+$/);
    }
  });

  it('deve montar os perfis só com permissões que existem no catálogo', () => {
    const perfis = [
      ...Object.values(PERFIS_GLOBAIS),
      ...Object.values(PERFIS_EMPRESA_PADRAO),
    ];
    for (const perfil of perfis) {
      for (const codigo of perfil.permissoes) {
        expect(PERMISSOES).toHaveProperty([codigo]);
      }
    }
  });

  it('não deve dar permissões de administrador da plataforma a perfis de empresa', () => {
    for (const perfil of Object.values(PERFIS_EMPRESA_PADRAO)) {
      expect(perfil.permissoes.some((c) => c.startsWith('admin:'))).toBe(false);
    }
  });
});
