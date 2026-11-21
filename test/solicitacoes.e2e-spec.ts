import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import {
  criarEmpresa,
  criarProfissional,
  criarTutor,
  entrar,
} from './utils/cenario';

/** Próxima segunda-feira depois de hoje, no formato AAAA-MM-DD. */
function proximaSegunda(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

describe('UC-40 · Horários disponíveis e solicitação de agendamento (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let tokenTutor: string;
  let servicoId: string;
  let petId: string;
  let profissionalId: string;
  const dia = proximaSegunda();
  const as15h = new Date(`${dia}T15:00:00-03:00`).toISOString();

  const http = () => request(app.getHttpServer());
  const comTutor = (r: request.Test) =>
    r.set('Authorization', `Bearer ${tokenTutor}`);
  const horarios = async () =>
    (
      await comTutor(
        http().get(
          `/v1/servicos/${servicoId}/horarios-disponiveis?data=${dia}`,
        ),
      ).expect(200)
    ).body as string[];

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    const empresaId = await criarEmpresa(app, prisma, 'clinica@exemplo.com');
    profissionalId = await criarProfissional(
      prisma,
      empresaId,
      'vet@exemplo.com',
    );
    await prisma.horarioAtuacao.create({
      data: {
        diaSemana: 'SEGUNDA',
        horaInicio: new Date('1970-01-01T14:00:00Z'),
        horaFim: new Date('1970-01-01T18:00:00Z'),
        funcionarioId: profissionalId,
      },
    });
    servicoId = (
      await prisma.servico.create({
        data: {
          empresaId,
          nome: 'Consulta',
          descricao: 'Consulta',
          categoria: 'CONSULTA',
          preco: 150,
          duracaoMinutos: 60,
          ativo: true,
        },
      })
    ).id;
    const tutorId = await criarTutor(prisma, 'ana@exemplo.com');
    const especie = await prisma.especie.create({ data: { nome: 'Cachorro' } });
    const raca = await prisma.raca.create({
      data: { nome: 'SRD', especieId: especie.id },
    });
    petId = (
      await prisma.pet.create({
        data: {
          nome: 'Thor',
          racaId: raca.id,
          sexo: 'MACHO',
          castrado: true,
          status: 'ATIVO',
          responsavelPet: {
            create: {
              tutorId,
              tipo: 'PRINCIPAL',
              ativo: true,
              dataVinculo: new Date(),
            },
          },
        },
      })
    ).id;
    tokenTutor = await entrar(app, 'ana@exemplo.com');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('deve oferecer os horários do turno de atuação em intervalos de 30 minutos (RN40)', async () => {
    const livres = await horarios();
    expect(livres).toHaveLength(7);
    expect(livres).toContain(as15h);
  });

  it('CT-40-01: deve deixar a solicitação pendente com a primeira entrada no histórico', async () => {
    const criada = await comTutor(http().post('/v1/solicitacoes'))
      .send({ servicoId, petId, dataHoraDesejada: as15h })
      .expect(201);
    expect(criada.body).toMatchObject({
      status: 'PENDENTE',
      dataHoraDesejada: as15h,
    });
    const historico = await prisma.historicoSolicitacao.findMany({
      where: { solicitacaoId: (criada.body as { id: string }).id },
    });
    expect(historico).toEqual([
      expect.objectContaining({ statusNovo: 'PENDENTE' }),
    ]);
    const minhas = await comTutor(
      http().get('/v1/solicitacoes?status=PENDENTE'),
    ).expect(200);
    expect(minhas.body).toHaveLength(1);
  });

  it('CT-40-02: deve informar o conflito quando o horário foi ocupado enquanto o tutor preenchia', async () => {
    await prisma.agendamento.create({
      data: {
        servicoId,
        petId: (
          await prisma.pet.create({
            data: {
              nome: 'Outro',
              racaId: (await prisma.raca.findFirstOrThrow()).id,
              sexo: 'FEMEA',
              castrado: false,
              status: 'ATIVO',
            },
          })
        ).id,
        profissionalId,
        precoContratado: 150,
        status: 'AGENDADO',
        dataHoraInicio: new Date(as15h),
        dataHoraFim: new Date(new Date(as15h).getTime() + 3_600_000),
        criadoEm: new Date(),
      },
    });
    const resposta = await comTutor(http().post('/v1/solicitacoes'))
      .send({ servicoId, petId, dataHoraDesejada: as15h })
      .expect(409);
    expect(resposta.body).toMatchObject({
      codigo: 'RN14_HORARIO_INDISPONIVEL',
    });
    const livres = await horarios();
    expect(livres).not.toContain(as15h);
    expect(livres).toHaveLength(4);
  });

  it('deve recusar pet que não é do tutor', async () => {
    const outro = await prisma.pet.findFirstOrThrow({
      where: { nome: 'Outro' },
    });
    await comTutor(http().post('/v1/solicitacoes'))
      .send({ servicoId, petId: outro.id, dataHoraDesejada: as15h })
      .expect(403);
  });
});
