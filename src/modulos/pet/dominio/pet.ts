/** Regras do pet (UC-04), sem dependência de framework. */

/** Idade em anos completos na data de referência (atributo derivado /idade do MOD-01). */
export function idadeEmAnos(
  nascimento: Date | null,
  hoje: Date,
): number | undefined {
  if (!nascimento) return undefined;
  let anos = hoje.getUTCFullYear() - nascimento.getUTCFullYear();
  const aniversarioAindaNaoChegou =
    hoje.getUTCMonth() < nascimento.getUTCMonth() ||
    (hoje.getUTCMonth() === nascimento.getUTCMonth() &&
      hoje.getUTCDate() < nascimento.getUTCDate());
  if (aniversarioAindaNaoChegou) anos -= 1;
  return Math.max(anos, 0);
}

/** RN08: pet com histórico clínico ou financeiro não é excluído, só arquivado. */
export function podeExcluirPet(historico: {
  registrosClinicos: number;
  despesas: number;
  agendamentos: number;
}): boolean {
  return (
    historico.registrosClinicos === 0 &&
    historico.despesas === 0 &&
    historico.agendamentos === 0
  );
}

export type NivelAcessoPet =
  'RESPONSAVEL_PRINCIPAL' | 'RESPONSAVEL' | 'EMPRESA' | 'NENHUM';

export const TAMANHO_MAXIMO_FOTO = 8 * 1024 * 1024;
const EXTENSOES_FOTO = ['jpg', 'jpeg', 'png', 'webp', 'heic'];

/** O que impede a foto, ou null se ela serve. */
export function problemaNaFoto(
  nomeArquivo: string,
  tamanhoBytes: number,
): string | null {
  const extensao = nomeArquivo.split('.').pop()?.toLowerCase() ?? '';
  if (!nomeArquivo.includes('.') || !EXTENSOES_FOTO.includes(extensao)) {
    return 'Envie uma foto em JPG, PNG, WEBP ou HEIC.';
  }
  if (tamanhoBytes <= 0) return 'A foto está vazia.';
  if (tamanhoBytes > TAMANHO_MAXIMO_FOTO) return 'A foto passa de 8 MB.';
  return null;
}

/** Cada foto nova ganha uma chave nova, para o app não mostrar a antiga do cache. */
export function chaveDaFoto(
  petId: string,
  id: string,
  nomeArquivo: string,
): string {
  const extensao = nomeArquivo.split('.').pop()!.toLowerCase();
  return `pets/${petId}/foto-${id}.${extensao}`;
}
