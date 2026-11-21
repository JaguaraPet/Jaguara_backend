import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';
import {
  ContextoPet,
  descreverPet,
  INSTRUCOES_SISTEMA,
  ProvedorAssistente,
  RESPOSTA_RECUSADA,
  TurnoConversa,
} from '../dominio/assistente';

/** Falha do provedor que a conversa mostra como indisponibilidade (ARQ-03, seção 3.5). */
export class AssistenteIndisponivel extends Error {}

/**
 * Provedor de IA do assistente pela API da Anthropic, com o SDK oficial.
 * As instruções fixas vão primeiro, com cache, e o contexto do pet logo depois.
 */
export class AssistenteAnthropic implements ProvedorAssistente {
  readonly nome = 'anthropic';
  private readonly log = new Logger(AssistenteAnthropic.name);

  constructor(
    private readonly cliente: Anthropic,
    private readonly modelo: string,
  ) {}

  async responder(pedido: {
    historico: TurnoConversa[];
    pet: ContextoPet | null;
  }): Promise<string> {
    let resposta: Anthropic.Beta.BetaMessage;
    try {
      resposta = await this.cliente.beta.messages.create({
        model: this.modelo,
        max_tokens: 4000,
        // Conversa curta de orientação: esforço baixo responde rápido e gasta menos.
        output_config: { effort: 'low' },
        // Se o modelo recusar por política, a API tenta de novo no modelo reserva.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: [
          {
            type: 'text',
            text: INSTRUCOES_SISTEMA,
            cache_control: { type: 'ephemeral' },
          },
          { type: 'text', text: descreverPet(pedido.pet) },
        ],
        // Cache automático do histórico, que cresce a cada mensagem.
        cache_control: { type: 'ephemeral' },
        messages: pedido.historico.map((t) => ({
          role:
            t.papel === 'tutor' ? ('user' as const) : ('assistant' as const),
          content: t.texto,
        })),
      });
    } catch (erro) {
      if (erro instanceof Anthropic.RateLimitError) {
        this.log.warn('Limite de requisições do provedor de IA atingido.');
      } else if (erro instanceof Anthropic.AuthenticationError) {
        this.log.error('Chave do provedor de IA inválida (ANTHROPIC_API_KEY).');
      } else if (erro instanceof Anthropic.APIError) {
        this.log.error(
          `Provedor de IA respondeu ${erro.status}: ${erro.message}`,
        );
      } else {
        this.log.error(`Falha ao chamar o provedor de IA: ${String(erro)}`);
      }
      throw new AssistenteIndisponivel();
    }

    if (resposta.stop_reason === 'refusal') return RESPOSTA_RECUSADA;
    const texto = resposta.content
      .flatMap((bloco) => (bloco.type === 'text' ? [bloco.text] : []))
      .join('')
      .trim();
    if (!texto) throw new AssistenteIndisponivel();
    return texto;
  }
}
