/** Documentos do pet (UC-34, RN15): formatos, tamanho e a chave do arquivo no armazenamento. */

export type TipoDocumento =
  | 'RG_ANIMAL'
  | 'CARTEIRA_VACINACAO'
  | 'ATESTADO'
  | 'RECEITA'
  | 'LAUDO'
  | 'PEDIGREE'
  | 'OUTRO';

export const TIPOS_DOCUMENTO: TipoDocumento[] = [
  'RG_ANIMAL',
  'CARTEIRA_VACINACAO',
  'ATESTADO',
  'RECEITA',
  'LAUDO',
  'PEDIGREE',
  'OUTRO',
];

export const TAMANHO_MAXIMO = 10 * 1024 * 1024;
export const EXTENSOES = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic'];

/** O que impede o envio, ou null se o arquivo serve. */
export function problemaNoArquivo(
  nomeArquivo: string,
  tamanhoBytes: number,
): string | null {
  const extensao = nomeArquivo.split('.').pop()?.toLowerCase() ?? '';
  if (!nomeArquivo.includes('.') || !EXTENSOES.includes(extensao)) {
    return 'Envie PDF ou imagem (JPG, PNG, WEBP ou HEIC).';
  }
  if (tamanhoBytes <= 0) return 'O arquivo está vazio.';
  if (tamanhoBytes > TAMANHO_MAXIMO) return 'O arquivo passa de 10 MB.';
  return null;
}

/** Nome seguro: sem caminho, só letras, números, ponto, hífen e sublinhado. */
export function nomeSeguro(nomeArquivo: string): string {
  const base = nomeArquivo.split(/[\\/]/).pop() ?? 'arquivo';
  const limpo = base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+/, '');
  return (limpo || 'arquivo').slice(-120);
}

/** Chave no bucket: pets/{petId}/documentos/{documentoId}/{nome}. */
export function chaveDoDocumento(
  petId: string,
  documentoId: string,
  nomeArquivo: string,
): string {
  return `pets/${petId}/documentos/${documentoId}/${nomeSeguro(nomeArquivo)}`;
}

/** Nome do arquivo a partir da chave guardada. */
export const nomeDaChave = (chave: string) =>
  chave.split('/').pop() ?? 'arquivo';
