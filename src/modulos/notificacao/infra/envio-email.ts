import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import { Ambiente } from '../../../compartilhado/config/ambiente';
import { MensagemEmail } from '../dominio/email';

/** Porta de envio de e-mail (ARQ-03): o provedor pode ser trocado sem mudar o domínio (RNF10). */
export interface EnvioEmail {
  enviar(mensagem: MensagemEmail): Promise<void>;
}

export const ENVIO_EMAIL = Symbol('EnvioEmail');

/** Envio por SMTP. No ambiente local aponta para o Mailpit (http://localhost:8025). */
export class EnvioEmailSmtp implements EnvioEmail {
  private readonly transporte: Transporter;

  constructor(
    host: string,
    porta: number,
    private readonly remetente: string,
  ) {
    this.transporte = createTransport({ host, port: porta, secure: false });
  }

  async enviar(mensagem: MensagemEmail): Promise<void> {
    await this.transporte.sendMail({
      from: this.remetente,
      to: mensagem.para,
      subject: mensagem.assunto,
      text: mensagem.texto,
      html: mensagem.html,
    });
  }
}

/** Envio pela API HTTP do provedor de e-mail transacional (Brevo), usado em homologação e produção. */
export class EnvioEmailApi implements EnvioEmail {
  private static readonly URL = 'https://api.brevo.com/v3/smtp/email';

  constructor(
    private readonly chave: string,
    private readonly remetente: string,
    private readonly http: typeof fetch = fetch,
  ) {}

  async enviar(mensagem: MensagemEmail): Promise<void> {
    const [, nome = 'Jaguara', email = this.remetente] =
      /^(.*?)\s*<(.+)>$/.exec(this.remetente) ?? [];
    const resposta = await this.http(EnvioEmailApi.URL, {
      method: 'POST',
      headers: {
        'api-key': this.chave,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: nome, email },
        to: [{ email: mensagem.para }],
        subject: mensagem.assunto,
        textContent: mensagem.texto,
        htmlContent: mensagem.html,
      }),
    });
    if (!resposta.ok) {
      // Lança para o BullMQ tentar de novo com espera exponencial.
      throw new Error(`Provedor de e-mail respondeu ${resposta.status}`);
    }
  }
}

/** Escolhe o adaptador pela variável EMAIL_PROVEDOR. */
export function criarEnvioEmail(
  config: ConfigService<Ambiente, true>,
): EnvioEmail {
  const remetente = config.get('EMAIL_REMETENTE', { infer: true });
  if (config.get('EMAIL_PROVEDOR', { infer: true }) === 'api') {
    const chave = config.get('EMAIL_API_KEY', { infer: true });
    if (!chave)
      throw new Error('EMAIL_API_KEY é obrigatória com EMAIL_PROVEDOR=api');
    return new EnvioEmailApi(chave, remetente);
  }
  new Logger('EnvioEmail').log('Enviando e-mails por SMTP');
  return new EnvioEmailSmtp(
    config.get('SMTP_HOST', { infer: true }),
    config.get('SMTP_PORTA', { infer: true }),
    remetente,
  );
}
