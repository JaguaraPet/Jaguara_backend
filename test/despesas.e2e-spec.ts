import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarPet, criarTutor, entrar } from './utils/cenario';

interface Categoria {
  id: string;
  nome: string;
}

describe('UC-06 · Despesas do pet e categorias (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let tokenAna: string;
  let tokenBia: string;
  let petId: string;
  let alimentacao: Categoria;

  const http = () => request(app.getHttpServer());
  const como = (t: string, r: request.Test) =>
    r.set('Authorization', `Bearer ${t}`);

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    const anaId = await criarTutor(prisma, 'ana@exemplo.com', 'Ana');
    tokenAna = await entrar(app, 'ana@exemplo.com');
    await criarTutor(prisma, 'bia@exemplo.com', 'Bia');
    tokenBia = await entrar(app, 'bia@exemplo.com');
    petId = await criarPet(prisma, anaId);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('deve listar as categorias padrão criadas na subida da API', async () => {
    const resposta = await como(
      tokenAna,
      http().get('/v1/categorias-despesa'),
    ).expect(200);
    const categorias = resposta.body as Categoria[];
    expect(categorias.map((c) => c.nome)).toEqual(
      expect.arrayContaining(['Alimentação', 'Saúde', 'Outros']),
    );
    alimentacao = categorias.find((c) => c.nome === 'Alimentação')!;
  });

  it('CT-06-01: deve registrar a despesa e mostrar no histórico do pet', async () => {
    await como(
      tokenAna,
      http().post(`/v1/pets/${petId}/despesas`).send({
        descricao: 'Ração 15 kg',
        valor: 189.9,
        data: '2026-11-10',
        categoriaId: alimentacao.id,
      }),
    ).expect(201);
    const lista = await como(
      tokenAna,
      http().get(`/v1/pets/${petId}/despesas?de=2026-11-01&ate=2026-11-30`),
    ).expect(200);
    expect(lista.body).toEqual([
      expect.objectContaining({
        descricao: 'Ração 15 kg',
        valor: 189.9,
        categoria: 'Alimentação',
      }),
    ]);
  });

  it('CT-06-02: não deve salvar sem categoria', async () => {
    const resposta = await como(
      tokenAna,
      http()
        .post(`/v1/pets/${petId}/despesas`)
        .send({ descricao: 'Coleira', valor: 50, data: '2026-11-10' }),
    ).expect(422);
    expect(JSON.stringify(resposta.body)).toContain('categoria');
  });

  it('deve esconder as despesas de quem não é responsável e recusar valor inválido', async () => {
    await como(tokenBia, http().get(`/v1/pets/${petId}/despesas`)).expect(404);
    await como(
      tokenAna,
      http().post(`/v1/pets/${petId}/despesas`).send({
        descricao: 'Coleira',
        valor: 0,
        data: '2026-11-10',
        categoriaId: alimentacao.id,
      }),
    ).expect(422);
  });
});
