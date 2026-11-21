import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarEmpresa, entrar } from './utils/cenario';

interface Atendimento {
  id: string;
  status: string;
  total: number;
  itens: { servicoId: string; valorUnitario: number; quantidade: number }[];
}

describe('UC-23 · Registro de atendimento com itens e auditoria (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let token: string;
  let tokenOutra: string;
  let banho: string;
  let hidratacao: string;
  let ocorrido: string;
  let futuro: string;
  let atendimento: Atendimento;

  const http = () => request(app.getHttpServer());
  const como = (t: string, r: request.Test) =>
    r.set('Authorization', `Bearer ${t}`);

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    const empresaId = await criarEmpresa(app, prisma, 'banho@exemplo.com');
    token = await entrar(app, 'banho@exemplo.com');
    await criarEmpresa(app, prisma, 'outra@exemplo.com', 'Outra Empresa');
    tokenOutra = await entrar(app, 'outra@exemplo.com');

    const servico = (nome: string, preco: number) =>
      prisma.servico.create({
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
    banho = (await servico('Banho', 60)).id;
    hidratacao = (await servico('Hidratação', 25)).id;
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
      },
    });
    const agendar = async (horas: number) => {
      const inicio = new Date(Date.now() + horas * 3_600_000);
      return (
        await prisma.agendamento.create({
          data: {
            servicoId: banho,
            petId: pet.id,
            dataHoraInicio: inicio,
            dataHoraFim: new Date(inicio.getTime() + 3_600_000),
            precoContratado: 60,
            status: 'AGENDADO',
            criadoEm: new Date(),
          },
        })
      ).id;
    };
    ocorrido = await agendar(-2);
    futuro = await agendar(24);
    // O preço mudou depois da contratação (CT-23-01).
    await prisma.servico.update({ where: { id: banho }, data: { preco: 70 } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('CT-23-01: deve cobrar o banho pelo preço contratado e o extra pelo preço atual', async () => {
    const resposta = await como(
      token,
      http()
        .post(`/v1/agendamentos/${ocorrido}/atendimento`)
        .send({
          procedimentosRealizados: 'Banho completo e secagem',
          observacoesClinicas: 'Pele sem alterações',
          itens: [
            { servicoId: banho, quantidade: 1 },
            {
              servicoId: hidratacao,
              quantidade: 1,
              observacao: 'Pelo ressecado',
            },
          ],
        }),
    ).expect(201);
    atendimento = resposta.body as Atendimento;
    expect(atendimento.status).toBe('FINALIZADO');
    expect(atendimento.itens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ servicoId: banho, valorUnitario: 60 }),
        expect.objectContaining({ servicoId: hidratacao, valorUnitario: 25 }),
      ]),
    );
    expect(atendimento.total).toBe(85);
    const agendamento = await prisma.agendamento.findUniqueOrThrow({
      where: { id: ocorrido },
    });
    expect(agendamento.status).toBe('REALIZADO');
  });

  it('deve recusar registro repetido, agendamento futuro, dados incompletos e outra empresa', async () => {
    const corpo = {
      procedimentosRealizados: 'Banho',
      itens: [{ servicoId: banho, quantidade: 1 }],
    };
    const repetido = await como(
      token,
      http().post(`/v1/agendamentos/${ocorrido}/atendimento`).send(corpo),
    ).expect(409);
    expect(repetido.body).toMatchObject({
      codigo: 'ATENDIMENTO_JA_REGISTRADO',
    });
    const cedo = await como(
      token,
      http().post(`/v1/agendamentos/${futuro}/atendimento`).send(corpo),
    ).expect(409);
    expect(cedo.body).toMatchObject({ codigo: 'AGENDAMENTO_NAO_OCORREU' });
    await como(
      token,
      http()
        .post(`/v1/agendamentos/${futuro}/atendimento`)
        .send({ procedimentosRealizados: 'Banho', itens: [] }),
    ).expect(422);
    await como(
      tokenOutra,
      http().get(`/v1/agendamentos/${ocorrido}/atendimento`),
    ).expect(403);
  });

  it('CT-23-02: deve exigir justificativa e auditar a alteração do atendimento finalizado', async () => {
    await como(
      token,
      http()
        .patch(`/v1/atendimentos/${atendimento.id}`)
        .send({ observacoesClinicas: 'Otite leve no ouvido esquerdo' }),
    ).expect(422);

    const alterado = await como(
      token,
      http().patch(`/v1/atendimentos/${atendimento.id}`).send({
        observacoesClinicas: 'Otite leve no ouvido esquerdo',
        justificativa: 'Observação esquecida no registro',
      }),
    ).expect(200);
    expect(alterado.body).toMatchObject({
      observacoesClinicas: 'Otite leve no ouvido esquerdo',
    });
    const log = await prisma.logAuditoria.findFirstOrThrow({
      where: { acao: 'ATENDIMENTO_ALTERADO', entidadeId: atendimento.id },
    });
    expect(log.nivel).toBe('CRITICO');
    expect(log.detalhes).toContain('Pele sem alterações');
    expect(log.detalhes).toContain('Observação esquecida');

    const consulta = await como(
      token,
      http().get(`/v1/agendamentos/${ocorrido}/atendimento`),
    ).expect(200);
    expect(consulta.body).toMatchObject({ id: atendimento.id, total: 85 });
  });
});
