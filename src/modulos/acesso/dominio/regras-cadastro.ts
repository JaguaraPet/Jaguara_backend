/** Regras de cadastro do UC-01 e do UC-32 (RN01, RN02), sem dependência de framework. */

export const HORAS_VALIDADE_CONFIRMACAO = 24;

/** E-mail comparado sempre em minúsculas e sem espaços nas pontas. */
export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Política de senha: pelo menos 8 caracteres, com letra e número (ARQ-02).
 * Devolve a mensagem do que falta, ou null se a senha serve.
 */
export function problemaNaSenha(senha: string): string | null {
  if (senha.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (!/[A-Za-zÀ-ÿ]/.test(senha) || !/\d/.test(senha)) {
    return 'A senha precisa ter letras e números.';
  }
  return null;
}

/** Confere os dígitos verificadores do CNPJ (RN01). */
export function cnpjValido(cnpj: string): boolean {
  const d = cnpj.replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const digito = (base: string) => {
    const pesos =
      base.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const resto =
      [...base].reduce((total, n, i) => total + Number(n) * pesos[i], 0) % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return (
    digito(d.slice(0, 12)) === Number(d[12]) &&
    digito(d.slice(0, 13)) === Number(d[13])
  );
}

/** O link de confirmação vale 24 horas e só pode ser usado uma vez (RN02). */
export function tokenUtilizavel(
  token: { utilizado: boolean; expiraEm: Date },
  agora: Date,
): boolean {
  return !token.utilizado && token.expiraEm > agora;
}

/** O link de recuperação de senha vale no máximo 2 horas e uma única vez (RN05). */
export const MINUTOS_VALIDADE_RECUPERACAO = 120;

/** RN06: quantas senhas anteriores não podem voltar. */
export const SENHAS_ANTERIORES_BLOQUEADAS = 3;
