import { montarEmail } from './email';

describe('montarEmail', () => {
  it('deve incluir o link e a validade quando monta a confirmação de cadastro', () => {
    const msg = montarEmail({
      tipo: 'CONFIRMACAO_CADASTRO',
      para: 'ana@exemplo.com',
      dados: {
        nome: 'Ana',
        link: 'http://localhost:5173/confirmar-email?token=abc',
        validadeHoras: 24,
      },
    });
    expect(msg.para).toBe('ana@exemplo.com');
    expect(msg.assunto).toContain('Confirme');
    expect(msg.texto).toContain('token=abc');
    expect(msg.texto).toContain('24 horas');
    expect(msg.html).toContain(
      'href="http://localhost:5173/confirmar-email?token=abc"',
    );
  });

  it('deve dizer que o link é de uso único quando monta a recuperação de senha', () => {
    const msg = montarEmail({
      tipo: 'RECUPERACAO_SENHA',
      para: 'ana@exemplo.com',
      dados: {
        nome: 'Ana',
        link: 'http://x/redefinir?token=1',
        validadeMinutos: 30,
      },
    });
    expect(msg.assunto).toContain('senha');
    expect(msg.texto).toContain('30 minutos');
    expect(msg.texto).toContain('uma vez');
  });

  it('deve escapar o HTML quando o nome tem caracteres especiais', () => {
    const msg = montarEmail({
      tipo: 'CONFIRMACAO_CADASTRO',
      para: 'x@exemplo.com',
      dados: {
        nome: '<script>alert(1)</script>',
        link: 'http://x',
        validadeHoras: 24,
      },
    });
    expect(msg.html).not.toContain('<script>');
    expect(msg.html).toContain('&lt;script&gt;');
  });
});
