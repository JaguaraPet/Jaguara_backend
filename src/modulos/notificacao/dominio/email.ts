/** Mensagens de e-mail transacional (ARQ-03, seção 3.3). */
export type TipoEmail =
  | 'CONFIRMACAO_CADASTRO'
  | 'RECUPERACAO_SENHA'
  | 'CONVITE_FUNCIONARIO'
  | 'TERMO_CLIENTE'
  | 'COMPROVANTE_CONSENTIMENTO'
  | 'AGENDAMENTO_CRIADO'
  | 'PAGAMENTO_CONFIRMADO'
  | 'COMPARTILHAMENTO_PET'
  | 'NOTIFICACAO';

export interface DadosEmail {
  CONFIRMACAO_CADASTRO: { nome: string; link: string; validadeHoras: number };
  RECUPERACAO_SENHA: { nome: string; link: string; validadeMinutos: number };
  CONVITE_FUNCIONARIO: {
    nome: string;
    empresa: string;
    link: string;
    validadeHoras: number;
  };
  TERMO_CLIENTE: {
    nome: string;
    empresa: string;
    link: string;
    validadeDias: number;
  };
  COMPROVANTE_CONSENTIMENTO: {
    nome: string;
    empresa: string;
    versao: string;
    dataHora: string;
    link: string;
  };
  AGENDAMENTO_CRIADO: {
    nome: string;
    pet: string;
    servico: string;
    dataHora: string;
  };
  PAGAMENTO_CONFIRMADO: {
    nome: string;
    pet: string;
    servico: string;
    valor: string;
  };
  COMPARTILHAMENTO_PET: {
    tutor: string;
    pet: string;
    secoes: string;
    link: string;
    validade: string | null;
  };
  NOTIFICACAO: { titulo: string; mensagem: string };
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
  botao: { texto: string; link: string } | null,
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
        ${
          botao
            ? `<p style="margin:24px 0">
          <a href="${escaparHtml(botao.link)}" style="display:inline-block;padding:12px 24px;background:${COR_PRIMARIA};color:#FFFFFF;text-decoration:none;border-radius:8px;font-weight:600">${botao.texto}</a>
        </p>`
            : ''
        }
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
    case 'CONVITE_FUNCIONARIO': {
      const d = pedido.dados as DadosEmail['CONVITE_FUNCIONARIO'];
      const nome = escaparHtml(d.nome);
      const empresa = escaparHtml(d.empresa);
      return {
        para: pedido.para,
        assunto: `${d.empresa} convidou você para o Jaguara`,
        texto: [
          `Olá, ${d.nome}!`,
          `${d.empresa} cadastrou você como funcionário no Jaguara Enterprise. Para ativar seu acesso, confirme seu e-mail e crie sua senha pelo link abaixo:`,
          d.link,
          `O link vale por ${d.validadeHoras} horas. Se você não conhece esta empresa, ignore este e-mail.`,
        ].join('\n\n'),
        html: layout(
          'Você foi convidado',
          [
            `Olá, ${nome}!`,
            `${empresa} cadastrou você como funcionário no Jaguara Enterprise. Confirme seu e-mail e crie sua senha para entrar.`,
          ],
          { texto: 'Criar minha senha', link: d.link },
          `O link vale por ${d.validadeHoras} horas. Se você não conhece esta empresa, ignore este e-mail.`,
        ),
      };
    }
    case 'TERMO_CLIENTE': {
      const d = pedido.dados as DadosEmail['TERMO_CLIENTE'];
      return {
        para: pedido.para,
        assunto: `${d.empresa}: termo de consentimento para o seu cadastro`,
        texto: [
          `Olá, ${d.nome}!`,
          `${d.empresa} quer cadastrar você e seus pets para os atendimentos. Antes, leia e aceite o termo de consentimento pelo link abaixo:`,
          d.link,
          `O link vale por ${d.validadeDias} dias. Sem o aceite, o pré-cadastro é excluído.`,
        ].join('\n\n'),
        html: layout(
          'Termo de consentimento',
          [
            `Olá, ${escaparHtml(d.nome)}!`,
            `${escaparHtml(d.empresa)} quer cadastrar você e seus pets para os atendimentos. Antes, leia e aceite o termo de consentimento.`,
          ],
          { texto: 'Ler o termo', link: d.link },
          `O link vale por ${d.validadeDias} dias. Sem o aceite, o pré-cadastro é excluído.`,
        ),
      };
    }
    case 'COMPROVANTE_CONSENTIMENTO': {
      const d = pedido.dados as DadosEmail['COMPROVANTE_CONSENTIMENTO'];
      return {
        para: pedido.para,
        assunto: `Comprovante do seu consentimento para ${d.empresa}`,
        texto: [
          `Olá, ${d.nome}!`,
          `Registramos seu aceite do termo de consentimento de ${d.empresa} (versão ${d.versao}) em ${d.dataHora}.`,
          `Você pode revogar quando quiser, pelo link abaixo, sem precisar de conta:`,
          d.link,
        ].join('\n\n'),
        html: layout(
          'Consentimento registrado',
          [
            `Olá, ${escaparHtml(d.nome)}!`,
            `Registramos seu aceite do termo de consentimento de ${escaparHtml(d.empresa)} (versão ${escaparHtml(d.versao)}) em ${escaparHtml(d.dataHora)}.`,
          ],
          { texto: 'Ver ou revogar', link: d.link },
          'Você pode revogar quando quiser por este link, sem precisar de conta.',
        ),
      };
    }
    case 'AGENDAMENTO_CRIADO': {
      const d = pedido.dados as DadosEmail['AGENDAMENTO_CRIADO'];
      const frase = `${d.servico} para ${d.pet} em ${d.dataHora}.`;
      return {
        para: pedido.para,
        assunto: `Agendamento confirmado: ${d.servico} para ${d.pet}`,
        texto: `Olá, ${d.nome}!\n\nA empresa agendou ${frase}\n\nAcompanhe e cancele pelo app do Jaguara.`,
        html: layout(
          'Agendamento confirmado',
          [
            `Olá, ${escaparHtml(d.nome)}!`,
            `A empresa agendou ${escaparHtml(frase)}`,
          ],
          null,
          'Acompanhe e cancele pelo app do Jaguara.',
        ),
      };
    }
    case 'PAGAMENTO_CONFIRMADO': {
      const d = pedido.dados as DadosEmail['PAGAMENTO_CONFIRMADO'];
      const frase = `${d.valor} de ${d.servico} para ${d.pet}`;
      return {
        para: pedido.para,
        assunto: `Pagamento confirmado: ${d.servico} para ${d.pet}`,
        texto: [
          `Olá, ${d.nome}!`,
          `Recebemos a confirmação do pagamento de ${frase}.`,
          'O comprovante fica no app do Jaguara, em Pagamentos.',
        ].join('\n\n'),
        html: layout(
          'Pagamento confirmado',
          [
            `Olá, ${escaparHtml(d.nome)}!`,
            `Recebemos a confirmação do pagamento de ${escaparHtml(frase)}.`,
          ],
          null,
          'O comprovante fica no app do Jaguara, em Pagamentos.',
        ),
      };
    }
    case 'COMPARTILHAMENTO_PET': {
      const d = pedido.dados as DadosEmail['COMPARTILHAMENTO_PET'];
      const prazo = d.validade
        ? `O link vale até ${d.validade}.`
        : 'O link vale até o tutor revogar.';
      return {
        para: pedido.para,
        assunto: `${d.tutor} compartilhou o perfil de ${d.pet} com você`,
        texto: [
          `${d.tutor} compartilhou com você estas informações de ${d.pet} no Jaguara: ${d.secoes}.`,
          'Veja pelo link abaixo, sem precisar de conta:',
          d.link,
          prazo,
        ].join('\n\n'),
        html: layout(
          `Perfil de ${escaparHtml(d.pet)}`,
          [
            `${escaparHtml(d.tutor)} compartilhou com você estas informações de ${escaparHtml(d.pet)} no Jaguara: ${escaparHtml(d.secoes)}.`,
          ],
          { texto: 'Ver o perfil', link: d.link },
          `${prazo} Se você não esperava este e-mail, ignore.`,
        ),
      };
    }
    case 'NOTIFICACAO': {
      const d = pedido.dados as DadosEmail['NOTIFICACAO'];
      const rodape =
        'Você recebe este lembrete por e-mail porque escolheu este canal no app do Jaguara.';
      return {
        para: pedido.para,
        assunto: d.titulo,
        texto: [d.mensagem, rodape].join('\n\n'),
        html: layout(
          escaparHtml(d.titulo),
          [escaparHtml(d.mensagem)],
          null,
          rodape,
        ),
      };
    }
  }
}
