/** Perfis de acesso criados pela empresa (UC-16, RN20). */
import { EMPRESA_TODAS } from './catalogo-permissoes';

/** O perfil da conta da empresa não muda nem sai, para a empresa não perder o próprio acesso. */
export const PERFIL_PROTEGIDO = 'Proprietário';

/** O que corrigir no perfil, ou null se ele vale. */
export function problemaNoPerfil(p: {
  nome: string;
  permissoes: string[];
}): { campo: string; mensagem: string } | null {
  const nome = p.nome.trim();
  if (nome.length < 3 || nome.length > 60) {
    return { campo: 'nome', mensagem: 'Use um nome de 3 a 60 caracteres.' };
  }
  if (p.permissoes.length === 0) {
    return { campo: 'permissoes', mensagem: 'Escolha ao menos uma permissão.' };
  }
  const invalidas = p.permissoes.filter(
    (c) => !(EMPRESA_TODAS as string[]).includes(c),
  );
  if (invalidas.length > 0) {
    return {
      campo: 'permissoes',
      mensagem: `Permissões que não existem para empresas: ${invalidas.join(', ')}.`,
    };
  }
  return null;
}

/** Nomes iguais sem diferença de maiúsculas, acentos e espaços. */
export const mesmoNome = (a: string, b: string) => {
  const n = (t: string) =>
    t.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  return n(a) === n(b);
};
