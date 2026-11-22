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

  it('deve trazer o nome da empresa e o link quando monta o convite de funcionário', () => {
    const msg = montarEmail({
      tipo: 'CONVITE_FUNCIONARIO',
      para: 'rafa@exemplo.com',
      dados: {
        nome: 'Rafa',
        empresa: 'Clínica Patas',
        link: 'http://x/primeiro-acesso?token=1',
        validadeHoras: 24,
      },
    });
    expect(msg.assunto).toContain('Clínica Patas');
    expect(msg.texto).toContain('primeiro-acesso?token=1');
    expect(msg.html).toContain('Criar minha senha');
  });

  it('deve trazer valor, serviço e pet quando confirma o pagamento', () => {
    const msg = montarEmail({
      tipo: 'PAGAMENTO_CONFIRMADO',
      para: 'ana@exemplo.com',
      dados: { nome: 'Ana', pet: 'Thor', servico: 'Banho', valor: 'R$ 60,00' },
    });
    expect(msg.assunto).toBe('Pagamento confirmado: Banho para Thor');
    expect(msg.texto).toContain('R$ 60,00 de Banho para Thor');
    expect(msg.html).toContain('Pagamento confirmado');
  });

  it('deve listar o que foi compartilhado e o link no compartilhamento do pet', () => {
    const msg = montarEmail({
      tipo: 'COMPARTILHAMENTO_PET',
      para: 'vet@exemplo.com',
      dados: {
        tutor: 'Ana',
        pet: 'Thor',
        secoes: 'vacinas, alergias e restrições',
        link: 'http://x/compartilhado/abc',
        validade: null,
      },
    });
    expect(msg.assunto).toBe('Ana compartilhou o perfil de Thor com você');
    expect(msg.texto).toContain('vacinas, alergias e restrições');
    expect(msg.texto).toContain('até o tutor revogar');
    expect(msg.html).toContain('http://x/compartilhado/abc');
  });

  it('deve dizer se a empresa aceitou e o motivo da recusa', () => {
    const base = {
      nome: 'Ana',
      empresa: 'Banho Cheiroso',
      pet: 'Thor',
      servico: 'Banho',
      dataHora: '25/11/2026 09:00',
    };
    const aceita = montarEmail({
      tipo: 'SOLICITACAO_RESPONDIDA',
      para: 'ana@exemplo.com',
      dados: { ...base, aceita: true },
    });
    expect(aceita.assunto).toBe('Pedido aceito: Banho para Thor');
    const recusada = montarEmail({
      tipo: 'SOLICITACAO_RESPONDIDA',
      para: 'ana@exemplo.com',
      dados: { ...base, aceita: false, motivo: 'Agenda cheia' },
    });
    expect(recusada.texto).toContain('Motivo: Agenda cheia');
    expect(recusada.html).toContain('Pedido não aceito');
  });
});
