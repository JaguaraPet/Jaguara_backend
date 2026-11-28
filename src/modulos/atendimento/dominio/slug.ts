/** Endereço curto da página pública da empresa: /e/{slug}. */
export const PADRAO_SLUG = /^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])$/;

/** "Clínica Vida Animal" vira "clinica-vida-animal". */
export function gerarSlug(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70)
    .replace(/-+$/g, '');
}

/** Endereços que não podem ser de empresas, para não confundir com páginas do Jaguara. */
export const SLUGS_RESERVADOS = new Set([
  'admin',
  'api',
  'app',
  'empresas',
  'jaguara',
  'entrar',
  'demonstracao',
  'suporte',
  'ajuda',
]);
