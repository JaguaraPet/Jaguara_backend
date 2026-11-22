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

describe('UC-07 · Relatório de despesas (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let tokenAna: string;
  let tokenBia: string;
  let petId: string;

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
    petId = await criarPet(prisma, anaId, 'Thor');
    const categorias = (
      await como(tokenAna, http().get('/v1/categorias-despesa')).expect(200)
    ).body as Categoria[];
    const id = (nome: string) => categorias.find((c) => c.nome === nome)!.id;
    for (const [descricao, valor, data, categoria] of [
      ['Ração 15 kg', 189.9, '2026-11-02', 'Alimentação'],
      ['Petisco', 25.5, '2026-11-05', 'Alimentação'],
      ['Consulta', 150, '2026-11-08', 'Saúde'],
      ['Ração de outubro', 180, '2026-10-02', 'Alimentação'],
    ] as const) {
      await como(
        tokenAna,
        http()
          .post(`/v1/pets/${petId}/despesas`)
          .send({ descricao, valor, data, categoriaId: id(categoria) }),
      ).expect(201);
    }
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('CT-07-01: deve gerar o relatório do período com o total por categoria', async () => {
    const resposta = await como(
      tokenAna,
      http().get(
        `/v1/relatorios/despesas?petId=${petId}&de=2026-11-01&ate=2026-11-30`,
      ),
    ).expect(200);
    expect(resposta.body).toMatchObject({
      total: 365.4,
      porCategoria: [
        { categoria: 'Alimentação', quantidade: 2, total: 215.4 },
        { categoria: 'Saúde', quantidade: 1, total: 150 },
      ],
    });
  });

  it('CT-07-01: deve exportar o relatório em PDF', async () => {
    const resposta = await como(
      tokenAna,
      http()
        .get('/v1/relatorios/despesas?de=2026-11-01&ate=2026-11-30')
        .set('Accept', 'application/pdf')
        .buffer(true)
        .parse((res, pronto) => {
          const partes: Buffer[] = [];
          res.on('data', (p: Buffer) => partes.push(p));
          res.on('end', () => pronto(null, Buffer.concat(partes)));
        }),
    ).expect(200);
    expect(resposta.headers['content-type']).toContain('application/pdf');
    const pdf = (resposta.body as Buffer).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('(Alimentação: R$ 215,40 \\(2 despesas\\)) Tj');
    expect(
      await prisma.relatorio.count({
        where: { tipo: 'DESPESAS', formato: 'PDF' },
      }),
    ).toBe(1);
  });

  it('CT-07-02: deve informar que não há dados para o período', async () => {
    const resposta = await como(
      tokenAna,
      http().get('/v1/relatorios/despesas?de=2026-09-01&ate=2026-09-30'),
    ).expect(404);
    expect(resposta.body).toMatchObject({ codigo: 'RN11_SEM_DADOS' });
  });

  it('deve esconder as despesas de outro tutor', async () => {
    await como(
      tokenBia,
      http().get(
        `/v1/relatorios/despesas?petId=${petId}&de=2026-11-01&ate=2026-11-30`,
      ),
    ).expect(404);
    const semPet = await como(
      tokenBia,
      http().get('/v1/relatorios/despesas?de=2026-11-01&ate=2026-11-30'),
    ).expect(404);
    expect(semPet.body).toMatchObject({ codigo: 'RN11_SEM_DADOS' });
  });
});
