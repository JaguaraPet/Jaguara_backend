import { BullModule } from '@nestjs/bullmq';
import { INestApplicationContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { validarAmbiente } from '../src/compartilhado/config/ambiente';
import { FilasModule } from '../src/compartilhado/filas/filas.module';
import { FilaEmailService } from '../src/modulos/notificacao/aplicacao/fila-email.service';
import { MensagemEmail } from '../src/modulos/notificacao/dominio/email';
import { EmailProcessor } from '../src/modulos/notificacao/infra/email.processor';
import { ENVIO_EMAIL } from '../src/modulos/notificacao/infra/envio-email';
import { NotificacaoModule } from '../src/modulos/notificacao/notificacao.module';

describe('Fila de e-mail (integração com Redis)', () => {
  let app: INestApplicationContext;
  const enviados: MensagemEmail[] = [];
  let falhasRestantes = 0;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validarAmbiente }),
        FilasModule,
        NotificacaoModule,
        BullModule.registerQueue({ name: 'email' }),
      ],
      providers: [
        EmailProcessor,
        {
          provide: ENVIO_EMAIL,
          useValue: {
            enviar: (m: MensagemEmail) => {
              if (falhasRestantes > 0) {
                falhasRestantes -= 1;
                return Promise.reject(new Error('provedor fora do ar'));
              }
              enviados.push(m);
              return Promise.resolve();
            },
          },
        },
      ],
    }).compile();
    app = await modulo.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function esperar(condicao: () => boolean, ms = 10_000) {
    const fim = Date.now() + ms;
    while (!condicao()) {
      if (Date.now() > fim) throw new Error('tempo esgotado');
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  it('deve enviar pelo worker quando a API coloca o e-mail na fila', async () => {
    await app
      .get(FilaEmailService)
      .enviar('CONFIRMACAO_CADASTRO', 'ana@exemplo.com', {
        nome: 'Ana',
        link: 'http://localhost:5173/confirmar-email?token=abc',
        validadeHoras: 24,
      });
    await esperar(() => enviados.length === 1);
    expect(enviados[0].assunto).toContain('Confirme');
    expect(enviados[0].para).toBe('ana@exemplo.com');
  });
});
