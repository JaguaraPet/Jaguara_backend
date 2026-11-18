import { StatusController } from './status.controller';

describe('StatusController', () => {
  it('deve responder ok quando o health check é chamado', () => {
    const resposta = new StatusController().verificar();
    expect(resposta.status).toBe('ok');
    expect(new Date(resposta.horario).toString()).not.toBe('Invalid Date');
  });
});
