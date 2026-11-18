import { Cifragem, cpfValido, mascararCpf, normalizarCpf } from './cifragem';

const chave = Buffer.alloc(32, 7).toString('base64');

describe('Cifragem', () => {
  const cifragem = new Cifragem(chave);

  it('cifra e decifra o mesmo texto', () => {
    const cifrado = cifragem.cifrar('52998224725');
    expect(Buffer.from(cifrado).toString('utf8')).not.toContain('52998224725');
    expect(cifragem.decifrar(cifrado)).toBe('52998224725');
  });

  it('gera valores cifrados diferentes para o mesmo texto', () => {
    expect(
      Buffer.from(cifragem.cifrar('abc')).equals(
        Buffer.from(cifragem.cifrar('abc')),
      ),
    ).toBe(false);
  });

  it('recusa valor adulterado', () => {
    const cifrado = cifragem.cifrar('52998224725');
    cifrado[cifrado.length - 1] ^= 1;
    expect(() => cifragem.decifrar(cifrado)).toThrow();
  });

  it('gera índice cego estável de 64 caracteres', () => {
    const indice = cifragem.indiceCego('52998224725');
    expect(indice).toHaveLength(64);
    expect(cifragem.indiceCego('52998224725')).toBe(indice);
    expect(
      new Cifragem(Buffer.alloc(32, 8).toString('base64')).indiceCego(
        '52998224725',
      ),
    ).not.toBe(indice);
  });

  it('recusa chave com tamanho errado', () => {
    expect(() => new Cifragem(Buffer.alloc(16).toString('base64'))).toThrow();
  });
});

describe('CPF', () => {
  it('normaliza e mascara', () => {
    expect(normalizarCpf('529.982.247-25')).toBe('52998224725');
    expect(mascararCpf('529.982.247-25')).toBe('***.982.247-**');
  });

  it('valida os dígitos verificadores', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('529.982.247-24')).toBe(false);
    expect(cpfValido('111.111.111-11')).toBe(false);
  });
});
