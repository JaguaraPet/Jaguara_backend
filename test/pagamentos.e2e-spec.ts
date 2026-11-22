import { INestApplication } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  assinaturaWebhook,
  GATEWAY_PAGAMENTO,
} from '../src/modulos/financeiro/dominio/pagamento';
import {
  CARTAO_RECUSADO,
  GatewaySimulado,
} from '../src/modulos/financeiro/infra/gateway-simulado';
import { FilaEmailService } from '../src/modulos/notificacao/aplicacao/fila-email.service';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarEmpresa, criarTutor, entrar } from './utils/cenario';

interface Pagamento {
  id: string;
  codigoTransacao: string;
  status: string;
  valor: number;
  qrCode?: string;
  boleto?: { url: string; linhaDigitavel: string; vencimento: string };
  motivoRecusa?: string;
}

const SEGREDO = 'segredo-webhook-teste';

describe('UC-44 · Pagamento com webhook de confirmação (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let gateway: GatewaySimulado;
  let tokenAna: string;
  let tokenEmpresa: string;
  let empresa: Socket;
  let banho: string;
  let tosa: string;
  let vacina: string;
  const emails: string[] = [];

  const http = () => request(app.getHttpServer());
  const pagar = (corpo: object, token = tokenAna) =>
    http()
      .post('/v1/pagamentos')
      .set('Authorization', `Bearer ${token}`)
      .send(corpo);

  /** Webhook como o Mercado Pago manda: data.id na URL e assinatura no cabeçalho. */
  const webhook = (dataId: string, segredo = SEGREDO) => {
    const ts = String(Date.now());
    const requestId = `req-${ts}`;
    const v1 = assinaturaWebhook(segredo, { dataId, requestId, ts });
    return http()
      .post(`/v1/webhooks/pagamentos?data.id=${dataId}&type=payment`)
      .set('x-signature', `ts=${ts},v1=${v1}`)
      .set('x-request-id', requestId)
      .send({
        type: 'payment',
        action: 'payment.updated',
        data: { id: dataId },
      });
  };

  beforeAll(async () => {
    delete process.env.MP_ACCESS_TOKEN;
    process.env.MP_WEBHOOK_SEGREDO = SEGREDO;
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    await app.listen(0);
    gateway = app.get(GATEWAY_PAGAMENTO);
    jest
      .spyOn(app.get(FilaEmailService), 'enviar')
      .mockImplementation((tipo) => {
        emails.push(tipo);
        return Promise.resolve();
      });

    const empresaId = await criarEmpresa(app, prisma, 'petshop@exemplo.com');
    tokenEmpresa = await entrar(app, 'petshop@exemplo.com');
    const anaId = await criarTutor(prisma, 'ana@exemplo.com', 'Ana');
    tokenAna = await entrar(app, 'ana@exemplo.com');
    const especie = await prisma.especie.create({ data: { nome: 'Cachorro' } });
    const raca = await prisma.raca.create({
      data: { nome: 'SRD', especieId: especie.id },
    });
    const pet = await prisma.pet.create({
      data: {
        nome: 'Thor',
        racaId: raca.id,
        sexo: 'MACHO',
        castrado: true,
        status: 'ATIVO',
        responsavelPet: {
          create: {
            tutorId: anaId,
            tipo: 'PRINCIPAL',
            ativo: true,
            dataVinculo: new Date(),
          },
        },
      },
    });
    const agendar = async (nome: string, preco: number, horas: number) => {
      const servico = await prisma.servico.create({
        data: {
          empresaId,
          nome,
          descricao: nome,
          categoria: 'BANHO_TOSA',
          preco,
          duracaoMinutos: 60,
          ativo: true,
        },
      });
      const inicio = new Date(Date.now() + horas * 3_600_000);
      const agendamento = await prisma.agendamento.create({
        data: {
          servicoId: servico.id,
          petId: pet.id,
          dataHoraInicio: inicio,
          dataHoraFim: new Date(inicio.getTime() + 3_600_000),
          precoContratado: preco,
          status: 'AGENDADO',
          criadoEm: new Date(),
        },
      });
      return agendamento.id;
    };
    banho = await agendar('Banho', 60, 48);
    tosa = await agendar('Tosa', 80, 72);
    vacina = await agendar('Vacina', 120, 96);

    const url = (await app.getUrl()).replace('[::1]', 'localhost');
    empresa = io(`${url}/tempo-real`, {
      auth: { token: tokenEmpresa },
      transports: ['websocket'],
      reconnection: false,
    });
    await new Promise((resolve) => empresa.once('conectado', resolve));
  });

  afterAll(async () => {
    empresa.disconnect();
    await app.close();
    await prisma.$disconnect();
  });

  it('CT-44-01: deve aceitar o PIX só depois da confirmação assinada do gateway', async () => {
    const criado = await pagar({ agendamentoId: banho, metodo: 'PIX' }).expect(
      201,
    );
    const pix = criado.body as Pagamento;
    expect(pix).toMatchObject({ status: 'PENDENTE', valor: 60 });
    expect(pix.qrCode).toContain('SIMULADO');

    // Sem pagamento no banco, o webhook não muda nada (RN39).
    await webhook(pix.codigoTransacao).expect(200);
    expect(
      (await prisma.pagamento.findUniqueOrThrow({ where: { id: pix.id } }))
        .status,
    ).toBe('PENDENTE');

    await webhook(pix.codigoTransacao, 'segredo-errado').expect(401);

    const avisoEmpresa = new Promise<Pagamento>((resolve) =>
      empresa.once('pagamento:atualizado', resolve),
    );
    gateway.pagarPix(pix.codigoTransacao);
    await webhook(pix.codigoTransacao).expect(200);
    await expect(avisoEmpresa).resolves.toMatchObject({
      id: pix.id,
      status: 'ACEITO',
    });
    const gravado = await prisma.pagamento.findUniqueOrThrow({
      where: { id: pix.id },
    });
    expect(gravado.status).toBe('ACEITO');
    expect(gravado.dataConfirmacao).not.toBeNull();

    // Evento repetido: idempotente, sem novo e-mail.
    await webhook(pix.codigoTransacao).expect(200);
    expect(emails.filter((e) => e === 'PAGAMENTO_CONFIRMADO')).toHaveLength(1);

    const repetido = await pagar({
      agendamentoId: banho,
      metodo: 'PIX',
    }).expect(409);
    expect(repetido.body).toMatchObject({ codigo: 'PAGAMENTO_JA_REALIZADO' });
  });

  it('CT-44-02: deve recusar o cartão com o motivo e deixar tentar com outro meio', async () => {
    const recusado = await pagar({
      agendamentoId: tosa,
      metodo: 'CARTAO_CREDITO',
      tokenCartao: CARTAO_RECUSADO,
      bandeiraCartao: 'visa',
    }).expect(201);
    expect(recusado.body).toMatchObject({
      status: 'RECUSADO',
      motivoRecusa: 'Saldo ou limite insuficiente.',
    });
    const aprovado = await pagar({
      agendamentoId: tosa,
      metodo: 'CARTAO_CREDITO',
      tokenCartao: 'cartao-teste-aprovado',
      bandeiraCartao: 'master',
      parcelas: 2,
    }).expect(201);
    expect(aprovado.body).toMatchObject({ status: 'ACEITO', valor: 80 });
  });

  it('deve emitir o boleto com o endereço, reaproveitá-lo e aceitar na compensação', async () => {
    const semEndereco = await pagar({
      agendamentoId: vacina,
      metodo: 'BOLETO',
    }).expect(422);
    expect(semEndereco.body).toMatchObject({ codigo: 'DADOS_INVALIDOS' });

    const criado = await pagar({
      agendamentoId: vacina,
      metodo: 'BOLETO',
      endereco: {
        cep: '01310100',
        logradouro: 'Avenida Paulista',
        numero: '1000',
        bairro: 'Bela Vista',
        cidade: 'São Paulo',
        uf: 'SP',
      },
    }).expect(201);
    const boleto = criado.body as Pagamento;
    expect(boleto).toMatchObject({ status: 'PENDENTE', valor: 120 });
    expect(boleto.boleto?.linhaDigitavel).toBeTruthy();

    // O endereço ficou guardado e o boleto em aberto volta igual.
    const deNovo = await pagar({
      agendamentoId: vacina,
      metodo: 'BOLETO',
    }).expect(201);
    expect(deNovo.body).toMatchObject({
      id: boleto.id,
      codigoTransacao: boleto.codigoTransacao,
    });

    gateway.pagarPix(boleto.codigoTransacao);
    await webhook(boleto.codigoTransacao).expect(200);
    expect(
      (await prisma.pagamento.findUniqueOrThrow({ where: { id: boleto.id } }))
        .status,
    ).toBe('ACEITO');
  });

  it('deve recusar pedido sem dados do cartão, sem assinatura e de quem não é tutor', async () => {
    await pagar({ agendamentoId: tosa, metodo: 'CARTAO_DEBITO' }).expect(422);
    await pagar({ agendamentoId: banho, metodo: 'PIX' }, tokenEmpresa).expect(
      403,
    );
    await http()
      .post('/v1/webhooks/pagamentos?data.id=1&type=payment')
      .send({})
      .expect(401);
  });
});
