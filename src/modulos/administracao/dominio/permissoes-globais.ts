/** Permissões dos perfis globais da plataforma (UC-29, RN35). */
import {
  EMPRESA_TODAS,
  PERMISSOES,
  TUTOR,
} from '../../acesso/dominio/catalogo-permissoes';

export type CategoriaPerfil = 'TUTOR' | 'EMPRESA' | 'ADMINISTRADOR';

/** O perfil global Tutor e o Empresa têm nome fixo; os demais são da administração. */
export function categoriaDoPerfil(nome: string): CategoriaPerfil {
  if (nome === 'Tutor') return 'TUTOR';
  if (nome === 'Empresa') return 'EMPRESA';
  return 'ADMINISTRADOR';
}

/** Categoria de cada permissão do catálogo. */
export function categoriaDaPermissao(codigo: string): CategoriaPerfil | null {
  if (codigo.startsWith('admin:') || codigo === 'relatorio:ler') {
    // relatorio:ler também é da empresa: vale nas duas.
    return codigo === 'relatorio:ler' ? null : 'ADMINISTRADOR';
  }
  if ((TUTOR as string[]).includes(codigo)) {
    return (EMPRESA_TODAS as string[]).includes(codigo) ? null : 'TUTOR';
  }
  if ((EMPRESA_TODAS as string[]).includes(codigo)) return 'EMPRESA';
  return null;
}

/** Pode entrar no perfil desta categoria? (permissões compartilhadas valem para ambas) */
function cabeNoPerfil(codigo: string, categoria: CategoriaPerfil): boolean {
  if (!(codigo in PERMISSOES)) return false;
  if (codigo === 'relatorio:ler') return categoria !== 'TUTOR';
  if (codigo === 'chat:usar' || codigo === 'notificacao:configurar') {
    return categoria !== 'ADMINISTRADOR';
  }
  return categoriaDaPermissao(codigo) === categoria;
}

/**
 * CT-29-02 e o fluxo alternativo: recusa perfil sem permissão, código inexistente e mistura de
 * categorias (por exemplo, permissão de administrador no perfil Tutor).
 */
export function problemaNasPermissoes(
  categoria: CategoriaPerfil,
  permissoes: string[],
): string | null {
  if (permissoes.length === 0)
    return 'O perfil precisa de ao menos uma permissão.';
  const fora = permissoes.filter((c) => !cabeNoPerfil(c, categoria));
  if (fora.length > 0) {
    const nome = {
      TUTOR: 'tutor',
      EMPRESA: 'empresa',
      ADMINISTRADOR: 'administrador',
    }[categoria];
    return `Estas permissões não cabem num perfil de ${nome}: ${fora.join(', ')}.`;
  }
  return null;
}
