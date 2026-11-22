import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarEmpresa, criarPet, criarTutor, entrar } from './utils/cenario';

describe('UC-17 · Indicadores de BI da empresa (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let empresaId: string;
  let outraId: string;
  let tokenDono: string;

  const http = () => request(app.getHttpServer());
  const como = (t: string, r: request.Test) =>
    r.set('Authorization', `Bearer ${t}`);
  const rota = (id: string) =>
    `/v1/empresas/${id}/indicadores?de=2026-11-01&ate=2026-11-30`;

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    empresaId = await criarEmpresa(app, prisma, 'clinica@exemplo.com');
    tokenDono = await entrar(app, 'clinica@exemplo.com');
    outraId = await criarEmpresa(app, prisma, 'outra@exemplo.com', 'Outra');
    const anaId = await criarTutor(prisma, 'ana@exemplo.com', 'Ana');
    const petId = await criarPet(prisma, anaId, 'Thor');
    for (const [empresa, nome] of [
      [empresaId, 'Banho'],
      [outraId, 'Tosa'],
    ]) {
      const servico = await prisma.servico.create({
        data: {
          empresaId: empresa,
          nome,
          descricao: nome,
          categoria: 'BANHO_TOSA',
          preco: 60,
          duracaoMinutos: 60,
          ativo: true,
        },
      });
      for (const status of ['ACEITA', 'RECUSADA', 'ACEITA'] as const) {
        const solicitacao = await prisma.solicitacaoServico.create({
          data: {
            dataSolicitacao: new Date('2026-11-03T12:00:00Z'),
            dataHoraDesejada: new Date('2026-11-10T13:00:00Z'),
            status,
            tutorId: anaId,
            petId,
            servicoId: servico.id,
          },
        });
        if (status === 'RECUSADA') continue;
        const agendamento = await prisma.agendamento.create({
          data: {
            servicoId: servico.id,
            petId,
            solicitacaoId: solicitacao.id,
            dataHoraInicio: new Date('2026-11-10T13:00:00Z'),
            dataHoraFim: new Date('2026-11-10T14:00:00Z'),
            precoContratado: 60,
            status: 'REALIZADO',
            criadoEm: new Date(),
          },
        });
        await prisma.pagamento.create({
          data: {
            codigoTransacao: `teste-${agendamento.id}`,
            valor: 60,
            dataHora: new Date('2026-11-10T15:00:00Z'),
            metodo: 'PIX',
            status: 'ACEITO',
            dataConfirmacao: new Date('2026-11-10T15:00:00Z'),
            pagadorId: anaId,
            recebedorId: empresa,
            agendamentoId: agendamento.id,
          },
        });
      }
    }
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('CT-17-01: deve mostrar os indicadores só com os dados da empresa', async () => {
    const resposta = await como(tokenDono, http().get(rota(empresaId))).expect(
      200,
    );
    expect(resposta.body).toMatchObject({
      atendimentos: 2,
      faturamento: 120,
      taxaAceite: 66.7,
      solicitacoes: 3,
      servicosMaisSolicitados: [{ servico: 'Banho', quantidade: 3 }],
    });
    const body = resposta.body as {
      atendimentosPorDia: { data: string; quantidade: number }[];
    };
    expect(body.atendimentosPorDia).toHaveLength(30);
    expect(body.atendimentosPorDia[9]).toEqual({
      data: '2026-11-10',
      quantidade: 2,
    });
  });

  it('CT-17-02: deve bloquear os indicadores de outra empresa', async () => {
    const resposta = await como(tokenDono, http().get(rota(outraId))).expect(
      403,
    );
    expect(resposta.body).toMatchObject({ codigo: 'SEM_PERMISSAO' });
  });
});
