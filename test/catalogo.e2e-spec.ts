import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarEmpresa, criarTutor, entrar } from './utils/cenario';

const banho = {
  nome: 'Banho',
  descricao: 'Banho com secagem',
  categoria: 'BANHO_TOSA',
  preco: 60,
  duracaoMinutos: 60,
};

describe('UC-38 · Catálogo de serviços e recursos (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let empresaId: string;
  let outraId: string;
  let tokenEmpresa: string;
  let tokenOutra: string;
  let tokenTutor: string;
  let servicoId: string;

  const http = () => request(app.getHttpServer());
  const com = (token: string, r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    empresaId = await criarEmpresa(
      app,
      prisma,
      'petshop@exemplo.com',
      'Pet Shop',
    );
    outraId = await criarEmpresa(app, prisma, 'outra@exemplo.com', 'Outra');
    await criarTutor(prisma, 'tutor@exemplo.com');
    tokenEmpresa = await entrar(app, 'petshop@exemplo.com');
    tokenOutra = await entrar(app, 'outra@exemplo.com');
    tokenTutor = await entrar(app, 'tutor@exemplo.com');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('CT-38-01: deve deixar o serviço ativo no catálogo quando a empresa cadastra banho de 60 minutos', async () => {
    const criado = await com(
      tokenEmpresa,
      http().post(`/v1/empresas/${empresaId}/servicos`),
    )
      .send(banho)
      .expect(201);
    servicoId = (criado.body as { id: string }).id;
    expect(criado.body).toMatchObject({ ...banho, ativo: true, empresaId });

    const catalogo = await com(
      tokenTutor,
      http().get(`/v1/empresas/${empresaId}/servicos`),
    ).expect(200);
    expect(catalogo.body).toEqual([
      expect.objectContaining({ nome: 'Banho', preco: 60 }),
    ]);
  });

  it('CT-38-02: deve manter o preço contratado quando a empresa muda o preço do serviço (RN27)', async () => {
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
    const agendamento = await prisma.agendamento.create({
      data: {
        servicoId,
        petId: pet.id,
        precoContratado: 60,
        status: 'AGENDADO',
        dataHoraInicio: new Date('2026-12-01T13:00:00Z'),
        dataHoraFim: new Date('2026-12-01T14:00:00Z'),
        criadoEm: new Date(),
      },
    });

    const alterado = await com(
      tokenEmpresa,
      http().patch(`/v1/servicos/${servicoId}`),
    )
      .send({ ...banho, preco: 70 })
      .expect(200);
    expect(alterado.body).toMatchObject({ preco: 70 });

    const depois = await prisma.agendamento.findUniqueOrThrow({
      where: { id: agendamento.id },
    });
    expect(depois.precoContratado.toNumber()).toBe(60);
  });

  it('deve esconder do tutor o serviço desativado, mas mostrar para a empresa', async () => {
    await com(tokenEmpresa, http().patch(`/v1/servicos/${servicoId}`))
      .send({ ...banho, ativo: false })
      .expect(200);
    const tutor = await com(
      tokenTutor,
      http().get(`/v1/empresas/${empresaId}/servicos`),
    ).expect(200);
    expect(tutor.body).toEqual([]);
    const empresa = await com(
      tokenEmpresa,
      http().get(`/v1/empresas/${empresaId}/servicos`),
    ).expect(200);
    expect(empresa.body).toEqual([expect.objectContaining({ ativo: false })]);
  });

  it('deve impedir outra empresa e o tutor de alterar o catálogo', async () => {
    await com(tokenOutra, http().patch(`/v1/servicos/${servicoId}`))
      .send(banho)
      .expect(403);
    await com(tokenOutra, http().post(`/v1/empresas/${empresaId}/servicos`))
      .send(banho)
      .expect(403);
    await com(tokenTutor, http().post(`/v1/empresas/${empresaId}/servicos`))
      .send(banho)
      .expect(403);
  });

  it('deve recusar duração menor que 5 minutos e preço negativo', async () => {
    await com(tokenEmpresa, http().post(`/v1/empresas/${empresaId}/servicos`))
      .send({ ...banho, duracaoMinutos: 2, preco: -1 })
      .expect(422);
  });

  it('deve cadastrar, listar e desativar recursos só da própria empresa', async () => {
    const criado = await com(
      tokenEmpresa,
      http().post(`/v1/empresas/${empresaId}/recursos`),
    )
      .send({ nome: 'Mesa de banho', tipo: 'EQUIPAMENTO' })
      .expect(201);
    const recursoId = (criado.body as { id: string }).id;
    await com(tokenEmpresa, http().patch(`/v1/recursos/${recursoId}`))
      .send({ nome: 'Mesa de banho 1', tipo: 'EQUIPAMENTO', ativo: false })
      .expect(200);
    const lista = await com(
      tokenEmpresa,
      http().get(`/v1/empresas/${empresaId}/recursos`),
    ).expect(200);
    expect(lista.body).toEqual([
      expect.objectContaining({ nome: 'Mesa de banho 1', ativo: false }),
    ]);
    await com(
      tokenOutra,
      http().get(`/v1/empresas/${empresaId}/recursos`),
    ).expect(403);
    await com(
      tokenOutra,
      http().get(`/v1/empresas/${outraId}/recursos`),
    ).expect(200);
  });
});
