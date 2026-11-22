/** Alergias e restrições do pet (UC-37). */

export type TipoAlergia =
  'ALERGIA' | 'RESTRICAO_ALIMENTAR' | 'RESTRICAO_MEDICAMENTOSA' | 'OUTRA';
export type Gravidade = 'LEVE' | 'MODERADA' | 'GRAVE';

const PESO: Record<Gravidade, number> = { GRAVE: 0, MODERADA: 1, LEVE: 2 };

/** As graves primeiro (destaque no perfil, CT-37-01), depois em ordem alfabética. */
export function ordenarAlergias<
  T extends { gravidade: Gravidade; descricao: string },
>(lista: T[]): T[] {
  return [...lista].sort(
    (a, b) =>
      PESO[a.gravidade] - PESO[b.gravidade] ||
      a.descricao.localeCompare(b.descricao, 'pt-BR'),
  );
}
