/** Importação de clientes por planilha: como um pet shop sai do caderno. */

export const MAXIMO_LINHAS_IMPORTACAO = 500;

export interface LinhaImportacao {
  nome: string;
  telefone?: string;
  email?: string;
  cpf?: string;
  observacoes?: string;
  petNome?: string;
  petEspecie?: string;
  petRaca?: string;
  /** "M", "F", "Macho" ou "Fêmea". */
  petSexo?: string;
  /** DD/MM/AAAA ou AAAA-MM-DD. */
  petNascimento?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizarTexto = (t: string) =>
  t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** O motivo para ignorar a linha, ou null quando ela pode entrar. */
export function problemaNaLinha(linha: LinhaImportacao): string | null {
  if (!linha.nome?.trim()) return 'Sem nome.';
  if (linha.email?.trim() && !EMAIL.test(linha.email.trim()))
    return 'E-mail inválido.';
  if (linha.petNome?.trim() && !linha.petEspecie?.trim())
    return 'Pet sem espécie.';
  if (linha.petNascimento?.trim() && !dataDaPlanilha(linha.petNascimento))
    return 'Data de nascimento do pet inválida.';
  return null;
}

export function sexoDaPlanilha(texto?: string): 'MACHO' | 'FEMEA' {
  const t = normalizarTexto(texto ?? '');
  return t.startsWith('f') ? 'FEMEA' : 'MACHO';
}

/** Aceita DD/MM/AAAA ou AAAA-MM-DD; devolve AAAA-MM-DD, ou null se a data não existe. */
export function dataDaPlanilha(texto: string): string | null {
  const t = texto.trim();
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  const iso = br
    ? `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`
    : /^\d{4}-\d{2}-\d{2}$/.test(t)
      ? t
      : null;
  if (!iso) return null;
  const data = new Date(`${iso}T12:00:00Z`);
  return data.toISOString().slice(0, 10) === iso ? iso : null;
}

/** Acha a espécie pelo nome, aceitando plural e sinônimos comuns ("cão", "cachorros"). */
export function especieDaPlanilha<T extends { nome: string }>(
  especies: T[],
  texto: string,
): T | undefined {
  const t = normalizarTexto(texto).replace(/s$/, '');
  const sinonimos: Record<string, string> = {
    cao: 'cachorro',
    cachorra: 'cachorro',
    cadela: 'cachorro',
    gata: 'gato',
    felino: 'gato',
    canino: 'cachorro',
    passaro: 'ave',
  };
  const alvo = sinonimos[t] ?? t;
  return especies.find(
    (e) => normalizarTexto(e.nome).replace(/s$/, '') === alvo,
  );
}
