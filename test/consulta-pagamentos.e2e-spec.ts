import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { FilaEmailService } from '../src/modulos/notificacao/aplicacao/fila-email.service';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarEmpresa, criarPet, criarTutor, entrar } from './utils/cenario';

interface Detalhe {
  id: string;
  status: string;
  descricao: string;
  contraparte: string;
  podeReembolsar: boolean;
  reembolso?: { status: string };
}

describe('UC-45 · Consulta de pagamentos e reembolso (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let tokenAna: string;
  let tokenBia: string;
  let tokenEmpresa: string;
  let aceito: string;
  let pendente: string;
  const emails: string[] = [];

  const http = () => request(app.getHttpServer());
  const como = (t: string, r: request.Test) =>
    r.set('Authorization', `Bearer ${t}`);

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    jest
      .spyOn(app.get(FilaEmailService), 'enviar')
      .mockImplementation((tipo) => {
        emails.push(tipo);
        return Promise.resolve();
      });
    const empresaId = await criarEmpresa(app, prisma, 'banho@exemplo.com');
    tokenEmpresa = await entrar(app, 'banho@exemplo.com');
    const anaId = await criarTutor(prisma, 'ana@exemplo.com', 'Ana');
    tokenAna = await entrar(app, 'ana@exemplo.com');
    await criarTutor(prisma, 'bia@exemplo.com', 'Bia');
    tokenBia = await entrar(app, 'bia@exemplo.com');
    const petId = await criarPet(prisma, anaId, 'Thor');
    const servico = await prisma.servico.create({
      data: {
        empresaId,
        nome: 'Banho',
        descricao: 'Banho',
        categoria: 'BANHO_TOSA',
        preco: 60,
        duracaoMinutos: 60,
        ativo: true,
      },
    });
    const pagar = async (status: 'ACEITO' | 'PENDENTE', horasAtras: number) => {
      const quando = new Date(Date.now() - horasAtras * 3_600_000);
      const ag = await prisma.agendamento.create({
        data: {
          servicoId: servico.id,
          petId,
          dataHoraInicio: quando,
          dataHoraFim: new Date(quando.getTime() + 3_600_000),
          precoContratado: 60,
          status: 'REALIZADO',
          criadoEm: quando,
        },
      });
      return (
        await prisma.pagamento.create({
          data: {
            codigoTransacao: `teste-${ag.id}`,
            valor: 60,
            dataHora: quando,
            metodo: 'PIX',
            status,
            dataConfirmacao: status === 'ACEITO' ? quando : null,
            pagadorId: anaId,
            recebedorId: empresaId,
            agendamentoId: ag.id,
          },
        })
      ).id;
    };
    aceito = await pagar('ACEITO', 48);
    pendente = await pagar('PENDENTE', 1);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('CT-45-01: deve listar os pagamentos do tutor com filtro e os recebidos pela empresa', async () => {
    const todos = await como(tokenAna, http().get('/v1/pagamentos')).expect(
      200,
    );
    const lista = todos.body as Detalhe[];
    expect(lista.map((p) => p.status)).toEqual(['PENDENTE', 'ACEITO']);
    expect(lista[1]).toMatchObject({
      descricao: 'Banho',
      contraparte: 'Clínica Teste',
      podeReembolsar: true,
    });
    const aceitos = await como(
      tokenAna,
      http().get('/v1/pagamentos?status=ACEITO'),
    ).expect(200);
    expect((aceitos.body as Detalhe[]).map((p) => p.id)).toEqual([aceito]);
    const recebidos = await como(
      tokenEmpresa,
      http().get('/v1/pagamentos'),
    ).expect(200);
    expect((recebidos.body as Detalhe[])[0]).toMatchObject({
      contraparte: 'Ana',
      podeReembolsar: false,
    });
    const bia = await como(tokenBia, http().get('/v1/pagamentos')).expect(200);
    expect(bia.body).toEqual([]);
    await como(tokenBia, http().get(`/v1/pagamentos/${aceito}`)).expect(404);
  });

  it('deve registrar o reembolso do pagamento confirmado e avisar a empresa', async () => {
    const r = await como(
      tokenAna,
      http()
        .post(`/v1/pagamentos/${aceito}/reembolsos`)
        .send({ motivo: 'O banho foi cancelado pela empresa' }),
    ).expect(201);
    expect(r.body).toMatchObject({
      reembolso: { status: 'EM_ANALISE' },
      podeReembolsar: false,
    });
    expect(emails).toContain('NOTIFICACAO');
    await como(
      tokenAna,
      http()
        .post(`/v1/pagamentos/${aceito}/reembolsos`)
        .send({ motivo: 'Pedindo de novo o reembolso' }),
    ).expect(409);
  });

  it('CT-45-02: deve recusar o reembolso de pagamento pendente', async () => {
    const r = await como(
      tokenAna,
      http()
        .post(`/v1/pagamentos/${pendente}/reembolsos`)
        .send({ motivo: 'Quero o dinheiro de volta' }),
    ).expect(409);
    expect(r.body).toMatchObject({ codigo: 'RN39_REEMBOLSO_INDISPONIVEL' });
  });
});
