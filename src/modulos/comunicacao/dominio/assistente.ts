/**
 * Regras do assistente virtual (UC-43, ARQ-03 seção 3.5, ARQ-02): o que vai para o
 * provedor de IA, as salvaguardas fixas e o limite diário por assinante.
 */

/** Só estes dados do pet saem da plataforma (ARQ-02, transferência internacional). */
export interface ContextoPet {
  nome: string;
  especie: string;
  raca: string;
  idade: string | null;
  alergias: string[];
}

export interface TurnoConversa {
  papel: 'tutor' | 'assistente';
  texto: string;
}

/** Contrato com o provedor de IA (porta `AssistenteVirtual` do ARQ-03). */
export interface ProvedorAssistente {
  readonly nome: string;
  responder(pedido: {
    historico: TurnoConversa[];
    pet: ContextoPet | null;
  }): Promise<string>;
}

export const PROVEDOR_ASSISTENTE = Symbol('PROVEDOR_ASSISTENTE');

/** Quantas mensagens anteriores vão como contexto. */
export const TURNOS_DE_CONTEXTO = 12;

/** Instruções fixas: não muda entre pedidos, para aproveitar o cache do provedor. */
export const INSTRUCOES_SISTEMA = `Você é o assistente virtual do Jaguara, um app brasileiro de cuidados com pets.
Responda em português do Brasil, com frases curtas e tom acolhedor, a dúvidas sobre rotina, alimentação, comportamento, higiene, vacinação e bem-estar de cães, gatos e outros pets.

Regras que valem sempre:
- Você orienta, mas não substitui o médico-veterinário. Não faça diagnóstico, não prescreva medicamentos nem doses e não interprete exames.
- Diante de sinais de urgência (dificuldade para respirar, convulsão, sangramento, suspeita de envenenamento, dor intensa, prostração), diga para procurar um veterinário ou pronto-atendimento imediatamente.
- Leve em conta as alergias e restrições do pet informadas no contexto antes de sugerir alimentos ou produtos.
- Não peça nem guarde dados pessoais do tutor (CPF, endereço, telefone). Se o tutor enviar, não repita.
- Se a pergunta não for sobre pets, diga com gentileza que só ajuda com assuntos de pets.
- Use no máximo três parágrafos curtos ou uma lista curta.`;

/** Aviso fixo do risco R08, enviado ao abrir a conversa. */
export const AVISO_INICIAL =
  'Olá! Sou o assistente virtual do Jaguara. Posso ajudar com dúvidas do dia a dia do seu pet, ' +
  'mas não substituo o veterinário: não faço diagnóstico nem receito remédios. ' +
  'Não envie dados pessoais por aqui.\n\nVocê pode começar por:\n' +
  '• Qual a melhor rotina de passeios para a idade dele?\n' +
  '• Que petiscos são seguros, considerando as alergias?\n' +
  '• Quando devo levar ao veterinário para o próximo check-up?';

export const RESPOSTA_INDISPONIVEL =
  'O assistente está indisponível agora. Tente de novo em alguns minutos. ' +
  'Se for urgente, procure um veterinário.';

export const RESPOSTA_RECUSADA =
  'Não posso ajudar com esse pedido. Para dúvidas de saúde do seu pet, procure um veterinário.';

/** Idade aproximada em texto, sem a data de nascimento (minimização, ARQ-02). */
export function idadeAproximada(
  nascimento: Date | null,
  hoje: Date,
): string | null {
  if (!nascimento) return null;
  let meses =
    (hoje.getUTCFullYear() - nascimento.getUTCFullYear()) * 12 +
    (hoje.getUTCMonth() - nascimento.getUTCMonth());
  if (hoje.getUTCDate() < nascimento.getUTCDate()) meses -= 1;
  if (meses < 0) return null;
  if (meses < 12) return meses <= 1 ? 'menos de 2 meses' : `${meses} meses`;
  const anos = Math.floor(meses / 12);
  return anos === 1 ? '1 ano' : `${anos} anos`;
}

/** Texto do contexto do pet que acompanha as instruções fixas. */
export function descreverPet(pet: ContextoPet | null): string {
  if (!pet) return 'O tutor não escolheu um pet para esta conversa.';
  const linhas = [
    `Pet da conversa: ${pet.nome}, ${pet.especie}, raça ${pet.raca}.`,
    `Idade: ${pet.idade ?? 'não informada'}.`,
    `Alergias e restrições: ${pet.alergias.length ? pet.alergias.join('; ') : 'nenhuma registrada'}.`,
  ];
  return linhas.join('\n');
}

/**
 * Histórico para o provedor: começa numa fala do tutor, alterna os papéis (falas
 * seguidas do mesmo papel viram uma só) e termina na fala do tutor.
 */
export function prepararHistorico(turnos: TurnoConversa[]): TurnoConversa[] {
  const recentes = turnos.slice(-TURNOS_DE_CONTEXTO);
  const inicio = recentes.findIndex((t) => t.papel === 'tutor');
  if (inicio < 0) return [];
  const juntos: TurnoConversa[] = [];
  for (const turno of recentes.slice(inicio)) {
    const ultimo = juntos[juntos.length - 1];
    if (ultimo && ultimo.papel === turno.papel) {
      ultimo.texto = `${ultimo.texto}\n\n${turno.texto}`;
    } else {
      juntos.push({ ...turno });
    }
  }
  while (juntos.length && juntos[juntos.length - 1].papel !== 'tutor') {
    juntos.pop();
  }
  return juntos;
}

/** Limite diário por assinante (ARQ-03, seção 3.5) para controlar o custo. */
export function excedeuLimite(enviadasHoje: number, limite: number): boolean {
  return enviadasHoje >= limite;
}
