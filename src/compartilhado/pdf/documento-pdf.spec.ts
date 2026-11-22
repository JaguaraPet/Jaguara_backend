import { gerarPdf, paginar, textoPdf } from './documento-pdf';

describe('documento-pdf (RN11)', () => {
  it('deve escapar parênteses e barras e trocar o que não é Latin-1', () => {
    expect(textoPdf('Ração (15 kg) \\ ok 🐶')).toBe(
      'Ração \\(15 kg\\) \\\\ ok ?',
    );
  });

  it('deve quebrar em páginas quando as linhas passam da margem', () => {
    const linhas = Array.from({ length: 80 }, (_, i) => ({ texto: `${i}` }));
    const paginas = paginar(linhas);
    expect(paginas.length).toBe(2);
    expect(paginas.flat()).toHaveLength(80);
  });

  it('deve gerar um PDF com a tabela de referências correta', () => {
    const pdf = gerarPdf('Relatório', [
      { texto: 'Despesas', negrito: true, tamanho: 16 },
      { texto: 'Alimentação: R$ 189,90' },
    ]);
    const texto = pdf.toString('latin1');
    expect(texto.startsWith('%PDF-1.4')).toBe(true);
    expect(texto.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(texto).toContain('(Alimentação: R$ 189,90) Tj');
    const inicioXref = Number(/startxref\n(\d+)/.exec(texto)![1]);
    expect(texto.slice(inicioXref, inicioXref + 4)).toBe('xref');
    const primeira = /0000000000 65535 f \n(\d{10})/.exec(texto)![1];
    expect(texto.slice(Number(primeira), Number(primeira) + 7)).toBe('1 0 obj');
  });
});
