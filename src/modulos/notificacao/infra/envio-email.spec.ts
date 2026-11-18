import { EnvioEmailApi } from './envio-email';

const mensagem = {
  para: 'ana@exemplo.com',
  assunto: 'Assunto',
  texto: 'Texto',
  html: '<p>Texto</p>',
};

describe('EnvioEmailApi', () => {
  it('deve enviar remetente, destinatário e conteúdo quando o provedor aceita', async () => {
    const http = jest.fn().mockResolvedValue({ ok: true, status: 201 });
    const envio = new EnvioEmailApi(
      'chave',
      'Jaguara <nao-responda@jaguarapet.com.br>',
      http,
    );

    await envio.enviar(mensagem);

    const [url, opcoes] = http.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(opcoes.headers).toMatchObject({ 'api-key': 'chave' });
    expect(JSON.parse(opcoes.body as string)).toMatchObject({
      sender: { name: 'Jaguara', email: 'nao-responda@jaguarapet.com.br' },
      to: [{ email: 'ana@exemplo.com' }],
      subject: 'Assunto',
    });
  });

  it('deve lançar erro para nova tentativa quando o provedor recusa', async () => {
    const http = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    const envio = new EnvioEmailApi('chave', 'Jaguara <x@exemplo.com>', http);
    await expect(envio.enviar(mensagem)).rejects.toThrow('503');
  });
});
