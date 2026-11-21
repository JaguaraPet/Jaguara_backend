/** Despesas do pet (UC-06, RN10). */

/** Categorias padrão, criadas ou mantidas quando a API sobe (RN10). */
export const CATEGORIAS_PADRAO: { nome: string; descricao: string }[] = [
  { nome: 'Alimentação', descricao: 'Ração, petiscos e suplementos' },
  { nome: 'Saúde', descricao: 'Consultas, exames, vacinas e cirurgias' },
  { nome: 'Medicamentos', descricao: 'Remédios e tratamentos' },
  { nome: 'Higiene', descricao: 'Banho, tosa e produtos de higiene' },
  { nome: 'Acessórios', descricao: 'Coleiras, camas, brinquedos e roupas' },
  { nome: 'Hospedagem e creche', descricao: 'Hotel, creche e pet sitter' },
  { nome: 'Adestramento', descricao: 'Aulas e treinamentos' },
  { nome: 'Outros', descricao: 'Demais gastos com o pet' },
];

/** Valor positivo com no máximo duas casas e até R$ 1 milhão. */
export function valorValido(valor: number): boolean {
  return (
    Number.isFinite(valor) &&
    valor > 0 &&
    valor <= 1_000_000 &&
    Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-6
  );
}

/** Total por categoria, em ordem decrescente de valor, somado em centavos. */
export function totaisPorCategoria(
  despesas: { categoria: string; valor: number }[],
): { categoria: string; total: number }[] {
  const centavos = new Map<string, number>();
  for (const d of despesas) {
    centavos.set(
      d.categoria,
      (centavos.get(d.categoria) ?? 0) + Math.round(d.valor * 100),
    );
  }
  return [...centavos.entries()]
    .map(([categoria, c]) => ({ categoria, total: c / 100 }))
    .sort(
      (a, b) => b.total - a.total || a.categoria.localeCompare(b.categoria),
    );
}
