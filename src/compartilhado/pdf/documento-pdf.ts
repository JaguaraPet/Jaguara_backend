/**
 * Gerador de PDF simples, sem dependência externa (RN11): páginas A4 com linhas de texto em
 * Helvetica. Basta para os relatórios de despesas (UC-07) e da empresa (UC-18).
 */

export interface LinhaPdf {
  texto: string;
  tamanho?: number;
  negrito?: boolean;
  /** Espaço extra antes da linha, em pontos. */
  antes?: number;
}

const LARGURA = 595;
const ALTURA = 842;
const MARGEM = 50;

/** Escapa o texto para uma string literal de PDF; fora do Latin-1 vira "?". */
export function textoPdf(texto: string): string {
  const latin1 = Array.from(texto)
    .map((c) => (c.charCodeAt(0) <= 0xff ? c : '?'))
    .join('');
  return latin1.replace(/[\\()]/g, (c) => `\\${c}`);
}

/** Distribui as linhas nas páginas, de cima para baixo, respeitando a margem. */
export function paginar(
  linhas: LinhaPdf[],
): { linha: LinhaPdf; y: number }[][] {
  const paginas: { linha: LinhaPdf; y: number }[][] = [[]];
  let y = ALTURA - MARGEM;
  for (const linha of linhas) {
    const altura = (linha.tamanho ?? 11) * 1.5 + (linha.antes ?? 0);
    if (y - altura < MARGEM) {
      paginas.push([]);
      y = ALTURA - MARGEM;
    }
    y -= altura;
    paginas[paginas.length - 1].push({ linha, y });
  }
  return paginas;
}

export function gerarPdf(titulo: string, linhas: LinhaPdf[]): Buffer {
  const paginas = paginar(linhas);
  const objetos: string[] = [];
  const novo = (corpo: string) => {
    objetos.push(corpo);
    return objetos.length;
  };
  const catalogo = novo('');
  const raiz = novo('');
  const fonte = novo(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  );
  const fonteNegrito = novo(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  );
  const info = novo(`<< /Title (${textoPdf(titulo)}) /Producer (Jaguara) >>`);
  const filhas: number[] = [];
  paginas.forEach((pagina, i) => {
    const comandos = pagina.map(({ linha, y }) => {
      const f = linha.negrito ? 'F2' : 'F1';
      return `BT /${f} ${linha.tamanho ?? 11} Tf ${MARGEM} ${y.toFixed(1)} Td (${textoPdf(linha.texto)}) Tj ET`;
    });
    comandos.push(
      `BT /F1 8 Tf ${LARGURA - MARGEM - 40} 30 Td (${i + 1} / ${paginas.length}) Tj ET`,
    );
    const fluxo = comandos.join('\n');
    const conteudo = novo(
      `<< /Length ${Buffer.byteLength(fluxo, 'latin1')} >>\nstream\n${fluxo}\nendstream`,
    );
    filhas.push(
      novo(
        `<< /Type /Page /Parent ${raiz} 0 R /MediaBox [0 0 ${LARGURA} ${ALTURA}] ` +
          `/Resources << /Font << /F1 ${fonte} 0 R /F2 ${fonteNegrito} 0 R >> >> /Contents ${conteudo} 0 R >>`,
      ),
    );
  });
  objetos[catalogo - 1] = `<< /Type /Catalog /Pages ${raiz} 0 R >>`;
  objetos[raiz - 1] =
    `<< /Type /Pages /Kids [${filhas.map((f) => `${f} 0 R`).join(' ')}] /Count ${filhas.length} >>`;

  let saida = '%PDF-1.4\n';
  const posicoes: number[] = [];
  objetos.forEach((corpo, i) => {
    posicoes.push(Buffer.byteLength(saida, 'latin1'));
    saida += `${i + 1} 0 obj\n${corpo}\nendobj\n`;
  });
  const xref = Buffer.byteLength(saida, 'latin1');
  saida += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  saida += posicoes
    .map((p) => `${String(p).padStart(10, '0')} 00000 n \n`)
    .join('');
  saida += `trailer\n<< /Size ${objetos.length + 1} /Root ${catalogo} 0 R /Info ${info} 0 R >>\n`;
  saida += `startxref\n${xref}\n%%EOF\n`;
  return Buffer.from(saida, 'latin1');
}
