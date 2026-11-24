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
  podeCancelar: boolean;
  motivoSemCancelamento?: string;
  servico: { nome: string };
  empresa: { nome: string };
  agendamento?: { id: string; status: string };
  historico: { statusNovo: string; autor: string }[];
}

describe('UC-42 · Acompanhamento das solicitações pelo tutor (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let tokenAna: string;
  let tokenBia: string;
  let tokenEmpresa: string;
  let pendente: string;
  let aceita: string;
  let passada: string;
  const emails: { tipo: string; dados: unknown }[] = [];

  const http = () => request(app.getHttpServer());
  const como = (t: string, r: request.Test) =>
    r.set('Authorization', `Bearer ${t}`);

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    jest
      .spyOn(app.get(FilaEmailService), 'enviar')
      .mockImplementation((tipo, _para, dados) => {
        emails.push({ tipo, dados });
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
    const pedir = async (horas: number, status: 'PENDENTE' | 'ACEITA') => {
      const quando = new Date(Date.now() + horas * 3_600_000);
      const s = await prisma.solicitacaoServico.create({
        data: {
          servicoId: servico.id,
          petId,
          tutorId: anaId,
          dataSolicitacao: new Date(),
          dataHoraDesejada: quando,
          status,
          historicoSolicitacao: {
            create: {
              dataHora: new Date(),
              statusNovo: 'PENDENTE',
              autorId: anaId,
            },
          },
        },
      });
      if (status === 'ACEITA') {
        await prisma.agendamento.create({
          data: {
            servicoId: servico.id,
            petId,
            solicitacaoId: s.id,
            dataHoraInicio: quando,
            dataHoraFim: new Date(quando.getTime() + 3_600_000),
            precoContratado: 60,
            status: 'AGENDADO',
            criadoEm: new Date(),
          },
        });
        await prisma.historicoSolicitacao.create({
          data: {
            solicitacaoId: s.id,
            dataHora: new Date(),
            statusAnterior: 'PENDENTE',
            statusNovo: 'ACEITA',
            autorId: empresaId,
          },
        });
      }
      return s.id;
    };
    pendente = await pedir(48, 'PENDENTE');
    aceita = await pedir(72, 'ACEITA');
    passada = await pedir(-2, 'ACEITA');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('deve listar as solicitações do tutor com nomes e situação', async () => {
    const resposta = await como(
      tokenAna,
      http().get('/v1/minhas-solicitacoes'),
    ).expect(200);
    const lista = resposta.body as Detalhe[];
    expect(lista).toHaveLength(3);
    expect(lista[0]).toMatchObject({
      servico: { nome: 'Banho' },
      empresa: { nome: 'Clínica Teste' },
    });
    const bia = await como(
      tokenBia,
      http().get('/v1/minhas-solicitacoes'),
    ).expect(200);
    expect(bia.body).toEqual([]);
  });

  it('CT-42-01: deve mostrar o status atual e o histórico da aceita', async () => {
    const resposta = await como(
      tokenAna,
      http().get(`/v1/solicitacoes/${aceita}`),
    ).expect(200);
    expect(resposta.body).toMatchObject({
      status: 'ACEITA',
      podeCancelar: true,
      agendamento: { status: 'AGENDADO' },
      historico: [
        { statusNovo: 'PENDENTE', autor: 'Você' },
        { statusNovo: 'ACEITA', autor: 'Clínica Teste' },
      ],
    });
    await como(tokenBia, http().get(`/v1/solicitacoes/${aceita}`)).expect(404);
    await como(tokenEmpresa, http().get(`/v1/solicitacoes/${aceita}`)).expect(
      403,
    );
  });

  it('deve cancelar a aceita, desfazer o agendamento e avisar a empresa', async () => {
    await como(
      tokenAna,
      http().post(`/v1/solicitacoes/${aceita}/cancelamento`),
    ).expect(204);
    const s = await prisma.solicitacaoServico.findUniqueOrThrow({
      where: { id: aceita },
      include: { agendamento: true },
    });
    expect(s.status).toBe('CANCELADA');
    expect(s.agendamento?.status).toBe('CANCELADO');
    expect(emails).toContainEqual(
      expect.objectContaining({
        tipo: 'SOLICITACAO_CANCELADA',
        dados: expect.objectContaining({
          agendamentoDesfeito: true,
        }) as unknown,
      }),
    );
    await como(
      tokenAna,
      http().post(`/v1/solicitacoes/${pendente}/cancelamento`),
    ).expect(204);
  });

  it('CT-42-02: deve bloquear o cancelamento depois do horário', async () => {
    const detalhe = await como(
      tokenAna,
      http().get(`/v1/solicitacoes/${passada}`),
    ).expect(200);
    expect(detalhe.body).toMatchObject({ podeCancelar: false });
    const resposta = await como(
      tokenAna,
      http().post(`/v1/solicitacoes/${passada}/cancelamento`),
    ).expect(409);
    expect(resposta.body).toMatchObject({
      codigo: 'RN38_CANCELAMENTO_BLOQUEADO',
    });
    expect(JSON.stringify(resposta.body)).toContain('já passou');
  });
});
