/** Registro de vacinação (UC-13, RN17). Datas no formato AAAA-MM-DD. */

export type ErroVacinacao =
  | { campo: 'responsavelAplicacao'; mensagem: string }
  | { campo: 'dataAplicacao'; mensagem: string }
  | { campo: 'dataProximaDose'; mensagem: string };

/**
 * CT-13-02: toda vacinação tem responsável e data de aplicação (RN17). A aplicação não pode
 * ser futura e a próxima dose vem depois dela.
 */
export function validarVacinacao(
  v: {
    responsavelAplicacao?: string;
    dataAplicacao: string;
    dataProximaDose?: string;
  },
  hoje: string,
): ErroVacinacao | null {
  if (!v.responsavelAplicacao?.trim()) {
    return {
      campo: 'responsavelAplicacao',
      mensagem: 'Informe quem aplicou a vacina.',
    };
  }
  if (v.dataAplicacao > hoje) {
    return {
      campo: 'dataAplicacao',
      mensagem: 'A data de aplicação não pode ser futura.',
    };
  }
  if (v.dataProximaDose && v.dataProximaDose <= v.dataAplicacao) {
    return {
      campo: 'dataProximaDose',
      mensagem: 'A próxima dose precisa ser depois da aplicação.',
    };
  }
  return null;
}
