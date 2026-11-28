import {
  dataDaPlanilha,
  especieDaPlanilha,
  problemaNaLinha,
  sexoDaPlanilha,
} from './importacao-clientes';

describe('importação de clientes', () => {
  it('deve recusar linha sem nome, e-mail inválido e pet sem espécie', () => {
    expect(problemaNaLinha({ nome: ' ' })).toBe('Sem nome.');
    expect(problemaNaLinha({ nome: 'Ana', email: 'ana@' })).toBe(
      'E-mail inválido.',
    );
    expect(problemaNaLinha({ nome: 'Ana', petNome: 'Rex' })).toBe(
      'Pet sem espécie.',
    );
    expect(problemaNaLinha({ nome: 'Ana', email: 'ana@x.com' })).toBeNull();
  });

  it('deve ler datas brasileiras e ISO e recusar data que não existe', () => {
    expect(dataDaPlanilha('5/3/2021')).toBe('2021-03-05');
    expect(dataDaPlanilha('2021-03-05')).toBe('2021-03-05');
    expect(dataDaPlanilha('31/02/2021')).toBeNull();
  });

  it('deve reconhecer espécie por sinônimo e plural, e o sexo pela inicial', () => {
    const especies = [{ nome: 'Cachorro' }, { nome: 'Gato' }];
    expect(especieDaPlanilha(especies, 'Cão')?.nome).toBe('Cachorro');
    expect(especieDaPlanilha(especies, 'gatos')?.nome).toBe('Gato');
    expect(especieDaPlanilha(especies, 'Dragão')).toBeUndefined();
    expect(sexoDaPlanilha('Fêmea')).toBe('FEMEA');
    expect(sexoDaPlanilha('')).toBe('MACHO');
  });
});
