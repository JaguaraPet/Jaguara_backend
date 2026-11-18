import { Queue } from 'bullmq';
import { PedidoEmail } from '../dominio/email';
import { FilaEmailService, TENTATIVAS_EMAIL } from './fila-email.service';

describe('FilaEmailService', () => {
  it('deve colocar o e-mail na fila com 5 tentativas e espera exponencial', async () => {
    const fila = { add: jest.fn().mockResolvedValue(undefined) };
    const servico = new FilaEmailService(fila as unknown as Queue<PedidoEmail>);
    const dados = { nome: 'Ana', link: 'http://x', validadeHoras: 24 };

    await servico.enviar('CONFIRMACAO_CADASTRO', 'ana@exemplo.com', dados);

    expect(fila.add).toHaveBeenCalledWith(
      'CONFIRMACAO_CADASTRO',
      { tipo: 'CONFIRMACAO_CADASTRO', para: 'ana@exemplo.com', dados },
      TENTATIVAS_EMAIL,
    );
    expect(TENTATIVAS_EMAIL).toMatchObject({
      attempts: 5,
      backoff: { type: 'exponential' },
    });
  });
});
