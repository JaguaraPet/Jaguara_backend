/** Responsáveis pelo pet (UC-05, RN09). */

export type TipoResponsavel = 'PRINCIPAL' | 'ADICIONAL';

export interface Vinculo {
  tutorId: string;
  tipo: TipoResponsavel;
}

/** RN09: depois da mudança, o pet continua com pelo menos um responsável principal? */
export function mantemPrincipal(
  ativos: Vinculo[],
  mudanca: { tutorId: string; novoTipo: TipoResponsavel | null },
): boolean {
  return ativos.some((v) => {
    const tipo = v.tutorId === mudanca.tutorId ? mudanca.novoTipo : v.tipo;
    return tipo === 'PRINCIPAL';
  });
}

/**
 * Quem pode mexer no vínculo: o responsável principal gerencia todos; o adicional só pode
 * sair do próprio vínculo.
 */
export function podeAlterarVinculo(
  autor: Vinculo,
  alvoTutorId: string,
  acao: 'remover' | 'mudarTipo' | 'adicionar',
): boolean {
  if (autor.tipo === 'PRINCIPAL') return true;
  return acao === 'remover' && autor.tutorId === alvoTutorId;
}
