import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { FilaEmailService } from '../src/modulos/notificacao/aplicacao/fila-email.service';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import {
  criarEmpresa,
  criarPet,
  criarProfissional,
  criarTutor,
  entrar,
} from './utils/cenario';

describe('UC-41 · Aceite e recusa de solicitações (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let token: string;
  let profissionalId: string;
  let primeira: string;
  let segunda: string;
  const emails: { tipo: string; dados: unknown }[] = [];

  const http = () => request(app.getHttpServer());
  const como = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

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
    token = await entrar(app, 'banho@exemplo.com');
    profissionalId = await criarProfissional(
      prisma,
      empresaId,
      'tosador@exemplo.com',
    );
    const anaId = await criarTutor(prisma, 'ana@exemplo.com', 'Ana');
    const petId = await criarPet(prisma, anaId);
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
    const pedir = async (horas: number) =>
      (
        await prisma.solicitacaoServico.create({
          data: {
            servicoId: servico.id,
            petId,
            tutorId: anaId,
            dataSolicitacao: new Date(),
            dataHoraDesejada: new Date(Date.now() + horas * 3_600_000),
            status: 'PENDENTE',
          },
        })
      ).id;
    primeira = await pedir(48);
    segunda = await pedir(72);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('CT-41-01: deve aceitar, criar o agendamento e avisar o tutor', async () => {
    const resposta = await como(
      http()
        .post(`/v1/solicitacoes/${primeira}/aceite`)
        .send({ profissionalId }),
    ).expect(200);
    expect(resposta.body).toMatchObject({
      status: 'AGENDADO',
      precoContratado: 60,
      profissionalId,
    });
    const solicitacao = await prisma.solicitacaoServico.findUniqueOrThrow({
      where: { id: primeira },
      include: { historicoSolicitacao: true, agendamento: true },
    });
    expect(solicitacao.status).toBe('ACEITA');
    expect(solicitacao.agendamento).not.toBeNull();
    expect(solicitacao.historicoSolicitacao.map((h) => h.statusNovo)).toContain(
      'ACEITA',
    );
    expect(emails).toContainEqual(
      expect.objectContaining({
        tipo: 'SOLICITACAO_RESPONDIDA',
        dados: expect.objectContaining({ aceita: true }) as unknown,
      }),
    );
    const repetida = await como(
      http().post(`/v1/solicitacoes/${primeira}/aceite`).send({}),
    ).expect(409);
    expect(repetida.body).toMatchObject({ codigo: 'SOLICITACAO_RESPONDIDA' });
  });

  it('CT-41-02: deve exigir o motivo da recusa', async () => {
    await como(
      http().post(`/v1/solicitacoes/${segunda}/recusa`).send({}),
    ).expect(422);
    await como(
      http()
        .post(`/v1/solicitacoes/${segunda}/recusa`)
        .send({ motivo: 'Sem horário com tosador nesse dia' }),
    ).expect(204);
    const recusada = await prisma.solicitacaoServico.findUniqueOrThrow({
      where: { id: segunda },
    });
    expect(recusada).toMatchObject({
      status: 'RECUSADA',
      motivoRecusa: 'Sem horário com tosador nesse dia',
    });
    expect(emails).toContainEqual(
      expect.objectContaining({
        dados: expect.objectContaining({
          aceita: false,
          motivo: 'Sem horário com tosador nesse dia',
        }) as unknown,
      }),
    );
  });
});
