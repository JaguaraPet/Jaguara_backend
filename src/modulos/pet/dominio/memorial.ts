/** Memorial do pet (UC-15, RN19). */

export type TipoItemMemorial = 'FOTO' | 'TEXTO' | 'HOMENAGEM';

export const FORMATOS_FOTO = ['jpg', 'jpeg', 'png', 'webp', 'heic'];
export const TAMANHO_MAXIMO_FOTO = 8 * 1024 * 1024;

/** RN19: o memorial só existe para pet falecido. */
export function memorialHabilitado(status: string): boolean {
  return status === 'FALECIDO';
}

/** O que corrigir no item, ou null se ele vale. */
export function problemaNoItem(item: {
  tipo: TipoItemMemorial;
  conteudo?: string;
  nomeArquivo?: string;
  tamanhoBytes?: number;
}): string | null {
  if (item.tipo === 'FOTO') {
    const extensao = item.nomeArquivo?.split('.').pop()?.toLowerCase() ?? '';
    if (!item.nomeArquivo || !FORMATOS_FOTO.includes(extensao)) {
      return 'Envie uma foto em JPG, PNG, WEBP ou HEIC.';
    }
    if (!item.tamanhoBytes || item.tamanhoBytes > TAMANHO_MAXIMO_FOTO) {
      return 'A foto precisa ter até 8 MB.';
    }
    return null;
  }
  const texto = item.conteudo?.trim() ?? '';
  if (texto.length < 2) return 'Escreva o texto da lembrança.';
  if (texto.length > 2000) return 'Use até 2.000 caracteres.';
  return null;
}
