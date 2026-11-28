import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarEmpresa, criarPet, criarTutor, entrar } from './utils/cenario';

describe('Avaliação depois do atendimento (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let tokenEmpresa: string;
  let tokenAna: string;
  let tokenBia: string;
  let empresaId: string;
  let realizado: string;
  let futuro: string;
  let avaliacaoId: string;

  const http = () => request(app.getHttpServer());
  const como = (t: string, r: request.Test) =>
    r.set('Authorization', `Bearer ${t}`);

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    empresaId = await criarEmpresa(app, prisma, 'patas@exemplo.com', 'Patas');
    tokenEmpresa = await entrar(app, 'patas@exemplo.com');
    await prisma.empresaEnterprise.update({
      where: { id: empresaId },
      data: { slug: 'patas' },
    });
    const ana = await criarTutor(prisma, 'ana@exemplo.com', 'Ana Ribeiro');
    tokenAna = await entrar(app, 'ana@exemplo.com');
    await criarTutor(prisma, 'bia@exemplo.com', 'Bia');
    tokenBia = await entrar(app, 'bia@exemplo.com');
    const petId = await criarPet(prisma, ana, 'Thor');
    const banho = await prisma.servico.create({
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
    const agendar = async (horas: number) => {
      const inicio = new Date(Date.now() + horas * 3_600_000);
      return (
        await prisma.agendamento.create({
          data: {
            servicoId: banho.id,
            petId,
            dataHoraInicio: inicio,
            dataHoraFim: new Date(inicio.getTime() + 3_600_000),
            precoContratado: 60,
            status: 'AGENDADO',
            criadoEm: new Date(),
          },
        })
      ).id;
    };
    realizado = await agendar(-3);
    futuro = await agendar(24);
    await como(
      tokenEmpresa,
      http().post(`/v1/agendamentos/${realizado}/atendimento`),
    )
      .send({
        procedimentosRealizados: 'Banho e secagem',
        itens: [{ servicoId: banho.id, quantidade: 1 }],
      })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('deve pedir a avaliação aos responsáveis depois do atendimento', async () => {
    const pedidos = await prisma.notificacao.count({
      where: { origemTipo: 'AVALIACAO', origemId: realizado },
    });
    expect(pedidos).toBe(1);
    const pendentes = await como(
      tokenAna,
      http().get('/v1/tutor/avaliacoes/pendentes'),
    ).expect(200);
    expect(pendentes.body).toEqual([
      expect.objectContaining({
        agendamentoId: realizado,
        empresa: 'Patas',
        pet: 'Thor',
        procedimentos: 'Banho e secagem',
      }),
    ]);
  });

  it('deve recusar nota fora de 1 a 5, agendamento futuro e quem não é responsável', async () => {
    await como(tokenAna, http().post(`/v1/agendamentos/${realizado}/avaliacao`))
      .send({ nota: 6 })
      .expect(422);
    await como(tokenAna, http().post(`/v1/agendamentos/${futuro}/avaliacao`))
      .send({ nota: 5 })
      .expect(409);
    await como(tokenBia, http().post(`/v1/agendamentos/${realizado}/avaliacao`))
      .send({ nota: 5 })
      .expect(403);
  });

  it('deve gravar e alterar a avaliação, e tirá-la das pendentes', async () => {
    await como(tokenAna, http().post(`/v1/agendamentos/${realizado}/avaliacao`))
      .send({ nota: 4 })
      .expect(201);
    const alterada = await como(
      tokenAna,
      http().post(`/v1/agendamentos/${realizado}/avaliacao`),
    )
      .send({ nota: 5, comentario: 'Voltou cheiroso e calmo' })
      .expect(201);
    avaliacaoId = (alterada.body as { id: string }).id;
    expect(alterada.body).toMatchObject({ nota: 5, servico: 'Banho' });
    const pendentes = await como(
      tokenAna,
      http().get('/v1/tutor/avaliacoes/pendentes'),
    ).expect(200);
    expect(pendentes.body).toEqual([]);
  });

  it('deve mostrar o resumo à empresa e publicar a resposta na página pública', async () => {
    const lista = await como(
      tokenEmpresa,
      http().get(`/v1/empresas/${empresaId}/avaliacoes`),
    ).expect(200);
    expect(lista.body).toMatchObject({
      resumo: { media: 5, total: 1, distribuicao: [0, 0, 0, 0, 1] },
    });
    await como(
      tokenEmpresa,
      http().put(
        `/v1/empresas/${empresaId}/avaliacoes/${avaliacaoId}/resposta`,
      ),
    )
      .send({ resposta: 'Obrigado, Ana!' })
      .expect(200);
    const vitrine = await http().get('/v1/publico/empresas/patas').expect(200);
    expect(vitrine.body).toMatchObject({
      avaliacoes: {
        media: 5,
        total: 1,
        recentes: [
          {
            autor: 'Ana',
            comentario: 'Voltou cheiroso e calmo',
            resposta: 'Obrigado, Ana!',
          },
        ],
      },
    });
  });
});
