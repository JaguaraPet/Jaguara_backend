import { Cifragem, cpfValido, mascararCpf, normalizarCpf } from './cifragem';

const chave = Buffer.alloc(32, 7).toString('base64');

describe('Cifragem', () => {
  const cifragem = new Cifragem(chave);

  it('deve decifrar o mesmo texto quando recebe o valor cifrado', () => {
    const cifrado = cifragem.cifrar('52998224725');
    expect(Buffer.from(cifrado).toString('utf8')).not.toContain('52998224725');
    expect(cifragem.decifrar(cifrado)).toBe('52998224725');
  });

  it('deve gerar valores diferentes quando cifra o mesmo texto duas vezes', () => {
    expect(
      Buffer.from(cifragem.cifrar('abc')).equals(
        Buffer.from(cifragem.cifrar('abc')),
      ),
    ).toBe(false);
  });

  it('deve recusar quando o valor cifrado foi adulterado', () => {
    const cifrado = cifragem.cifrar('52998224725');
    cifrado[cifrado.length - 1] ^= 1;
    expect(() => cifragem.decifrar(cifrado)).toThrow();
  });

  it('deve gerar índice cego estável de 64 caracteres quando a chave é a mesma', () => {
    const indice = cifragem.indiceCego('52998224725');
    expect(indice).toHaveLength(64);
    expect(cifragem.indiceCego('52998224725')).toBe(indice);
    expect(
      new Cifragem(Buffer.alloc(32, 8).toString('base64')).indiceCego(
        '52998224725',
      ),
    ).not.toBe(indice);
  });

  it('deve recusar quando a chave tem tamanho errado', () => {
    expect(() => new Cifragem(Buffer.alloc(16).toString('base64'))).toThrow();
  });
});

describe('CPF', () => {
  it('deve normalizar e mascarar quando recebe CPF formatado', () => {
    expect(normalizarCpf('529.982.247-25')).toBe('52998224725');
    expect(mascararCpf('529.982.247-25')).toBe('***.982.247-**');
  });

  it('deve validar os dígitos verificadores quando confere o CPF', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('529.982.247-24')).toBe(false);
    expect(cpfValido('111.111.111-11')).toBe(false);
  });
});
