import {
  ContextoPet,
  ProvedorAssistente,
  TurnoConversa,
} from '../dominio/assistente';

/**
 * Provedor usado sem chave de IA (desenvolvimento, testes e homologação sem custo):
 * respostas prontas por assunto, com as mesmas salvaguardas do assistente real.
 */
export class AssistenteSimulado implements ProvedorAssistente {
  readonly nome = 'simulado';

  responder(pedido: {
    historico: TurnoConversa[];
    pet: ContextoPet | null;
  }): Promise<string> {
    const pergunta = (
      pedido.historico[pedido.historico.length - 1]?.texto ?? ''
    ).toLowerCase();
    const nome = pedido.pet?.nome ?? 'seu pet';
    const alergias = pedido.pet?.alergias.length
      ? ` Lembre das restrições registradas: ${pedido.pet.alergias.join('; ')}.`
      : '';

    let resposta: string;
    if (/convuls|sangr|envenen|respirar|desmai/.test(pergunta)) {
      resposta = `Isso pode ser urgente. Leve ${nome} a um veterinário ou pronto-atendimento agora.`;
    } else if (/remédio|remedio|dose|medica/.test(pergunta)) {
      resposta = `Não posso indicar remédios nem doses. Converse com o veterinário de ${nome} antes de dar qualquer medicamento.`;
    } else if (/comer|comida|ração|racao|petisco|aliment/.test(pergunta)) {
      resposta = `Prefira a ração adequada à idade e ao porte de ${nome} e ofereça petiscos com moderação, até 10% das calorias do dia.${alergias}`;
    } else if (/passeio|exerc|brincar/.test(pergunta)) {
      resposta = `Passeios diários ajudam ${nome} a gastar energia. Evite os horários mais quentes e leve água.`;
    } else if (/vacina|vermífugo|vermifugo/.test(pergunta)) {
      resposta = `Mantenha a carteira de vacinação em dia no app e confirme com o veterinário o calendário de ${nome}.`;
    } else {
      resposta = `Posso ajudar com rotina, alimentação, passeios e cuidados do dia a dia de ${nome}. Conte um pouco mais sobre a sua dúvida.`;
    }
    return Promise.resolve(
      `${resposta}\n\n(Resposta simulada: o provedor de IA não está configurado.)`,
    );
  }
}
