import { randomInt } from 'node:crypto';

/** Domínio reservado (RFC 2606): e-mails de demonstração nunca são entregues. */
export const DOMINIO_DEMONSTRACAO = 'demonstracao.invalid';

export function emailDemonstracao(nome: string, sufixo: string): string {
  return `${nome}.${sufixo}@${DOMINIO_DEMONSTRACAO}`;
}

export function ehEmailDemonstracao(email: string): boolean {
  return email.toLowerCase().endsWith(`@${DOMINIO_DEMONSTRACAO}`);
}

function digitos(n: number): string {
  return Array.from({ length: n }, () => randomInt(0, 10)).join('');
}

/** CPF fictício com dígitos verificadores válidos, a partir de 9 dígitos-base. */
export function cpfComDigitos(base: string): string {
  const dig = (b: string) => {
    const soma = [...b].reduce(
      (t, n, i) => t + Number(n) * (b.length + 1 - i),
      0,
    );
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dig(base);
  return `${base}${d1}${dig(base + d1)}`;
}

/** CNPJ fictício com dígitos verificadores válidos, a partir de 12 dígitos-base. */
export function cnpjComDigitos(base: string): string {
  const dig = (b: string) => {
    const pesos =
      b.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = [...b].reduce((t, n, i) => t + Number(n) * pesos[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dig(base);
  return `${base}${d1}${dig(base + d1)}`;
}

/** CPF aleatório válido (prefixo 9, que não aparece em CPF real emitido para essas faixas de teste). */
export function cpfAleatorio(): string {
  return cpfComDigitos(`9${digitos(8)}`);
}

export function cnpjAleatorio(): string {
  return cnpjComDigitos(`9${digitos(7)}0001`);
}
