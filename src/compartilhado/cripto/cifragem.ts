import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

/**
 * Cifragem de colunas de nível Restrito (ARQ-02, seção 6): AES-256-GCM na aplicação,
 * antes de gravar. O valor cifrado guarda a versão da chave no primeiro byte, para permitir
 * rotação, seguido do vetor de inicialização, da etiqueta de autenticação e do texto cifrado.
 *
 * Para busca e unicidade (CPF), usa-se um índice cego: HMAC-SHA256 do valor normalizado
 * com uma chave derivada, nunca o valor em claro.
 */
const VERSAO_CHAVE = 1;
const TAMANHO_IV = 12;
const TAMANHO_TAG = 16;

export class Cifragem {
  private readonly chaveCifra: Buffer;
  private readonly chaveIndice: Buffer;

  constructor(chaveBase64: string) {
    const chave = Buffer.from(chaveBase64, 'base64');
    if (chave.length !== 32) {
      throw new Error('A chave de criptografia precisa ter 32 bytes');
    }
    this.chaveCifra = chave;
    this.chaveIndice = Buffer.from(
      hkdfSync('sha256', chave, Buffer.alloc(0), 'jaguara-indice-cego', 32),
    );
  }

  cifrar(texto: string): Uint8Array<ArrayBuffer> {
    const iv = randomBytes(TAMANHO_IV);
    const cifra = createCipheriv('aes-256-gcm', this.chaveCifra, iv);
    const conteudo = Buffer.concat([
      cifra.update(texto, 'utf8'),
      cifra.final(),
    ]);
    // Cópia em um ArrayBuffer próprio: é o tipo que o Prisma espera em colunas bytea.
    return Uint8Array.from(
      Buffer.concat([
        Buffer.from([VERSAO_CHAVE]),
        iv,
        cifra.getAuthTag(),
        conteudo,
      ]),
    );
  }

  decifrar(valor: Uint8Array): string {
    const dados = Buffer.from(valor);
    const versao = dados[0];
    if (versao !== VERSAO_CHAVE) {
      throw new Error(`Versão de chave desconhecida: ${versao}`);
    }
    const iv = dados.subarray(1, 1 + TAMANHO_IV);
    const tag = dados.subarray(1 + TAMANHO_IV, 1 + TAMANHO_IV + TAMANHO_TAG);
    const conteudo = dados.subarray(1 + TAMANHO_IV + TAMANHO_TAG);
    const decifra = createDecipheriv('aes-256-gcm', this.chaveCifra, iv);
    decifra.setAuthTag(tag);
    return Buffer.concat([decifra.update(conteudo), decifra.final()]).toString(
      'utf8',
    );
  }

  /** Índice cego de 64 caracteres hexadecimais (coluna `<nome>_hash`). */
  indiceCego(valor: string): string {
    return createHmac('sha256', this.chaveIndice).update(valor).digest('hex');
  }
}

/** Mantém só os dígitos do CPF, para cifrar e indexar sempre o mesmo formato. */
export function normalizarCpf(cpf: string): string {
  return cpf.replace(/\D/g, '');
}

/** Mostra o CPF mascarado: ***.456.789-** (ARQ-02). */
export function mascararCpf(cpf: string): string {
  const digitos = normalizarCpf(cpf);
  return `***.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-**`;
}

/** Confere os dígitos verificadores do CPF. */
export function cpfValido(cpf: string): boolean {
  const d = normalizarCpf(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const digito = (base: string) => {
    const soma = [...base].reduce(
      (total, n, i) => total + Number(n) * (base.length + 1 - i),
      0,
    );
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return (
    digito(d.slice(0, 9)) === Number(d[9]) &&
    digito(d.slice(0, 10)) === Number(d[10])
  );
}
