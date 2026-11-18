/** Mensagens de e-mail transacional (ARQ-03, seção 3.3). */
export type TipoEmail = 'CONFIRMACAO_CADASTRO' | 'RECUPERACAO_SENHA';

export interface DadosEmail {
  CONFIRMACAO_CADASTRO: { nome: string; link: string; validadeHoras: number };
  RECUPERACAO_SENHA: { nome: string; link: string; validadeMinutos: number };
}

export interface PedidoEmail<T extends TipoEmail = TipoEmail> {
  tipo: T;
  para: string;
  dados: DadosEmail[T];
}

export interface MensagemEmail {
  para: string;
  assunto: string;
  texto: string;
  html: string;
}

const COR_PRIMARIA = '#8A4B0F';
const COR_TEXTO = '#1E1B18';
const COR_TEXTO_SECUNDARIO = '#5C554E';

function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(
  titulo: string,
  paragrafos: string[],
  botao: { texto: string; link: string },
  rodape: string,
): string {
  const corpo = paragrafos
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:${COR_TEXTO}">${p}</p>`,
    )
    .join('');
  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#F7F3EE;font-family:Inter,Arial,sans-serif">
    <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:8px">
      <tr><td style="padding:32px">
        <p style="margin:0 0 24px;font-size:22px;font-weight:700;color:${COR_PRIMARIA}">Jaguara</p>
        <h1 style="margin:0 0 16px;font-size:22px;font-weight:600;color:${COR_TEXTO}">${titulo}</h1>
        ${corpo}
        <p style="margin:24px 0">
          <a href="${escaparHtml(botao.link)}" style="display:inline-block;padding:12px 24px;background:${COR_PRIMARIA};color:#FFFFFF;text-decoration:none;border-radius:8px;font-weight:600">${botao.texto}</a>
        </p>
        <p style="margin:0;font-size:14px;line-height:1.5;color:${COR_TEXTO_SECUNDARIO}">${rodape}</p>
      </td></tr>
    </table>
  </body>
</html>`;
}

/** Monta assunto, texto e HTML de cada tipo de e-mail. */
export function montarEmail(pedido: PedidoEmail): MensagemEmail {
  switch (pedido.tipo) {
    case 'CONFIRMACAO_CADASTRO': {
      const d = pedido.dados as DadosEmail['CONFIRMACAO_CADASTRO'];
      const nome = escaparHtml(d.nome);
      return {
        para: pedido.para,
        assunto: 'Confirme seu e-mail no Jaguara',
        texto: [
          `Olá, ${d.nome}!`,
          'Para ativar sua conta no Jaguara, confirme seu e-mail pelo link abaixo:',
          d.link,
          `O link vale por ${d.validadeHoras} horas. Se você não criou uma conta, ignore este e-mail.`,
        ].join('\n\n'),
        html: layout(
          'Confirme seu e-mail',
          [
            `Olá, ${nome}!`,
            'Para ativar sua conta no Jaguara, confirme seu e-mail.',
          ],
          { texto: 'Confirmar e-mail', link: d.link },
          `O link vale por ${d.validadeHoras} horas. Se você não criou uma conta, ignore este e-mail.`,
        ),
      };
    }
    case 'RECUPERACAO_SENHA': {
      const d = pedido.dados as DadosEmail['RECUPERACAO_SENHA'];
      const nome = escaparHtml(d.nome);
      return {
        para: pedido.para,
        assunto: 'Redefinição de senha do Jaguara',
        texto: [
          `Olá, ${d.nome}!`,
          'Recebemos um pedido para redefinir a senha da sua conta. Use o link abaixo:',
          d.link,
          `O link vale por ${d.validadeMinutos} minutos e só pode ser usado uma vez. Se você não pediu, ignore este e-mail: sua senha continua a mesma.`,
        ].join('\n\n'),
        html: layout(
          'Redefinição de senha',
          [
            `Olá, ${nome}!`,
            'Recebemos um pedido para redefinir a senha da sua conta.',
          ],
          { texto: 'Redefinir senha', link: d.link },
          `O link vale por ${d.validadeMinutos} minutos e só pode ser usado uma vez. Se você não pediu, ignore este e-mail: sua senha continua a mesma.`,
        ),
      };
    }
  }
}
