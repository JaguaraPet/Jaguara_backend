import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarEmpresa, criarTutor, entrar } from './utils/cenario';

interface Pet {
  id: string;
  nome: string;
  especie: string;
  raca: string;
  status: string;
  idade?: number;
}

describe('UC-04 · Pets (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let tokenAna: string;
  let tokenBruno: string;
  let tokenEmpresa: string;
  let empresaId: string;
  let racaId: string;
  let petId: string;

  const http = () => request(app.getHttpServer());
  const com = (token: string, r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`);
  const thor = () => ({
    nome: 'Thor',
    racaId,
    sexo: 'MACHO',
    castrado: true,
    dataNascimento: '2021-03-10',
    pesoKg: 29.5,
  });

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    const especie = await prisma.especie.create({ data: { nome: 'Cachorro' } });
    racaId = (
      await prisma.raca.create({
        data: { nome: 'Labrador', especieId: especie.id },
      })
    ).id;
    await criarTutor(prisma, 'ana@exemplo.com', 'Ana');
    await criarTutor(prisma, 'bruno@exemplo.com', 'Bruno');
    empresaId = await criarEmpresa(app, prisma, 'clinica@exemplo.com');
    tokenAna = await entrar(app, 'ana@exemplo.com');
    tokenBruno = await entrar(app, 'bruno@exemplo.com');
    tokenEmpresa = await entrar(app, 'clinica@exemplo.com');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('deve listar espécies e raças para escolher (RN07)', async () => {
    const especies = await com(tokenAna, http().get('/v1/especies')).expect(
      200,
    );
    expect(especies.body).toEqual([
      {
        id: expect.any(String) as string,
        nome: 'Cachorro',
        racas: [{ id: racaId, nome: 'Labrador' }],
      },
    ]);
  });

  it('CT-04-01: deve criar o pet com o tutor como responsável principal', async () => {
    const criado = await com(tokenAna, http().post('/v1/pets'))
      .send(thor())
      .expect(201);
    const pet = criado.body as Pet;
    petId = pet.id;
    expect(pet).toMatchObject({
      nome: 'Thor',
      especie: 'Cachorro',
      raca: 'Labrador',
      status: 'ATIVO',
    });
    expect(pet.idade).toBeGreaterThanOrEqual(5);
    const responsavel = await prisma.responsavelPet.findFirstOrThrow({
      where: { petId },
    });
    expect(responsavel.tipo).toBe('PRINCIPAL');
    const lista = await com(tokenAna, http().get('/v1/pets')).expect(200);
    expect(lista.body).toMatchObject({ total: 1, itens: [{ id: petId }] });
  });

  it('deve recusar raça fora da lista (RN07)', async () => {
    await com(tokenAna, http().post('/v1/pets'))
      .send({ ...thor(), racaId: '00000000-0000-4000-8000-000000000000' })
      .expect(422);
  });

  it('deve negar o pet a outro tutor e à empresa sem compartilhamento (RN24)', async () => {
    await com(tokenBruno, http().get(`/v1/pets/${petId}`)).expect(403);
    await com(tokenEmpresa, http().get(`/v1/pets/${petId}`)).expect(403);
    await com(tokenEmpresa, http().patch(`/v1/pets/${petId}`))
      .send(thor())
      .expect(403);
  });

  it('deve liberar a leitura à empresa quando o tutor compartilha o pet (RN26)', async () => {
    await prisma.compartilhamentoPet.create({
      data: {
        petId,
        empresaId,
        token: 'teste-compartilhamento',
        escopos: ['PERFIL_BASICO'],
        status: 'ATIVO',
        dataConcessao: new Date(),
      },
    });
    await com(tokenEmpresa, http().get(`/v1/pets/${petId}`)).expect(200);
    // Ler não dá direito a alterar os dados do pet (RN30).
    await com(tokenEmpresa, http().patch(`/v1/pets/${petId}`))
      .send(thor())
      .expect(403);
  });

  it('deve deixar o responsável editar o pet', async () => {
    const editado = await com(tokenAna, http().patch(`/v1/pets/${petId}`))
      .send({ ...thor(), nome: 'Thor Ribeiro', cor: 'Caramelo' })
      .expect(200);
    expect(editado.body).toMatchObject({
      nome: 'Thor Ribeiro',
      cor: 'Caramelo',
    });
  });

  it('CT-04-02: deve impedir a exclusão e oferecer o arquivamento quando o pet tem histórico (RN08)', async () => {
    const servico = await prisma.servico.create({
      data: {
        empresaId,
        nome: 'Consulta',
        descricao: 'Consulta',
        categoria: 'CONSULTA',
        preco: 100,
        duracaoMinutos: 30,
        ativo: true,
      },
    });
    await prisma.agendamento.create({
      data: {
        servicoId: servico.id,
        petId,
        precoContratado: 100,
        status: 'REALIZADO',
        dataHoraInicio: new Date('2026-11-10T13:00:00Z'),
        dataHoraFim: new Date('2026-11-10T13:30:00Z'),
        criadoEm: new Date(),
      },
    });
    const resposta = await com(
      tokenAna,
      http().delete(`/v1/pets/${petId}`),
    ).expect(409);
    expect(resposta.body).toMatchObject({ codigo: 'RN08_PET_COM_HISTORICO' });

    await com(tokenAna, http().post(`/v1/pets/${petId}/arquivamento`)).expect(
      204,
    );
    const arquivados = await com(
      tokenAna,
      http().get('/v1/pets?status=ARQUIVADO'),
    ).expect(200);
    expect(arquivados.body).toMatchObject({ total: 1 });

    await com(tokenAna, http().delete(`/v1/pets/${petId}/arquivamento`)).expect(
      204,
    );
    const ativos = await com(
      tokenAna,
      http().get('/v1/pets?status=ATIVO'),
    ).expect(200);
    expect(ativos.body).toMatchObject({ total: 1 });
    await com(tokenAna, http().delete(`/v1/pets/${petId}/arquivamento`)).expect(
      409,
    );
  });

  it('deve excluir pet sem histórico', async () => {
    const criado = await com(tokenAna, http().post('/v1/pets'))
      .send({ ...thor(), nome: 'Mia' })
      .expect(201);
    await com(
      tokenAna,
      http().delete(`/v1/pets/${(criado.body as Pet).id}`),
    ).expect(204);
  });
});
