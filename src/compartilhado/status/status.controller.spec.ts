import { StatusController } from './status.controller';

describe('StatusController', () => {
  it('responde ok no health check', () => {
    const resposta = new StatusController().verificar();
    expect(resposta.status).toBe('ok');
    expect(new Date(resposta.horario).toString()).not.toBe('Invalid Date');
  });
});
