import type Anthropic from '@anthropic-ai/sdk';
import { INSTRUCOES_SISTEMA, RESPOSTA_RECUSADA } from '../dominio/assistente';
import {
  AssistenteAnthropic,
  AssistenteIndisponivel,
} from './assistente-anthropic';
import { AssistenteSimulado } from './assistente-simulado';

describe('provedores do assistente', () => {
  const pedido = {
    historico: [{ papel: 'tutor' as const, texto: 'Que petisco posso dar?' }],
    pet: {
      nome: 'Thor',
      especie: 'Cachorro',
      raca: 'SRD',
      idade: '3 anos',
      alergias: ['Frango (gravidade alta)'],
    },
  };

  const clienteFalso = (create: jest.Mock) =>
    ({ beta: { messages: { create } } }) as unknown as Anthropic;

  it('deve chamar o provedor com as instruções fixas em cache e devolver o texto', async () => {
    const create = jest.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: ' Petiscos sem frango. ' },
      ],
    });
    const provedor = new AssistenteAnthropic(
      clienteFalso(create),
      'modelo-teste',
    );
    await expect(provedor.responder(pedido)).resolves.toBe(
      'Petiscos sem frango.',
    );
    const [parametros] = create.mock.calls[0] as [
      Anthropic.Beta.MessageCreateParamsNonStreaming,
    ];
    expect(parametros.model).toBe('modelo-teste');
    expect(parametros.system).toEqual([
      {
        type: 'text',
        text: INSTRUCOES_SISTEMA,
        cache_control: { type: 'ephemeral' },
      },
      expect.objectContaining({
        text: expect.stringContaining('Frango') as unknown,
      }),
    ]);
    expect(parametros.messages).toEqual([
      { role: 'user', content: 'Que petisco posso dar?' },
    ]);
  });

  it('deve trocar a recusa por uma resposta segura e a falha por indisponível', async () => {
    const recusa = jest
      .fn()
      .mockResolvedValue({ stop_reason: 'refusal', content: [] });
    await expect(
      new AssistenteAnthropic(clienteFalso(recusa), 'm').responder(pedido),
    ).resolves.toBe(RESPOSTA_RECUSADA);

    const falha = jest.fn().mockRejectedValue(new Error('rede'));
    await expect(
      new AssistenteAnthropic(clienteFalso(falha), 'm').responder(pedido),
    ).rejects.toBeInstanceOf(AssistenteIndisponivel);

    const vazia = jest
      .fn()
      .mockResolvedValue({ stop_reason: 'end_turn', content: [] });
    await expect(
      new AssistenteAnthropic(clienteFalso(vazia), 'm').responder(pedido),
    ).rejects.toBeInstanceOf(AssistenteIndisponivel);
  });

  it('deve simular respostas seguras sem chave de IA', async () => {
    const simulado = new AssistenteSimulado();
    await expect(simulado.responder(pedido)).resolves.toContain('Frango');
    await expect(
      simulado.responder({
        pet: null,
        historico: [{ papel: 'tutor', texto: 'Qual a dose de remédio?' }],
      }),
    ).resolves.toContain('Não posso indicar remédios');
    await expect(
      simulado.responder({
        pet: null,
        historico: [{ papel: 'tutor', texto: 'Ele teve uma convulsão' }],
      }),
    ).resolves.toContain('urgente');
  });
});
