import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarEmpresa, criarTutor, entrar } from './utils/cenario';

interface Pagina {
  itens: {
    nomeFantasia: string;
    distanciaKm?: number;
    precoAPartirDe?: number;
    totalAvaliacoes: number;
  }[];
  total: number;
}

describe('Busca de empresas por perto (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let token: string;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    const servico = (empresaId: string, preco: number) =>
      prisma.servico.create({
        data: {
          empresaId,
          nome: 'Banho',
          descricao: 'Banho',
          categoria: 'BANHO_TOSA',
          preco,
          duracaoMinutos: 60,
          ativo: true,
        },
      });
    // O geocodificador simulado dos testes afasta a empresa conforme o CEP.
    const longe = await criarEmpresa(app, prisma, 'longe@exemplo.com', 'Longe');
    await prisma.empresaEnterprise.update({
      where: { id: longe },
      data: { enderecoCep: '01900000' },
    });
    await servico(longe, 40);
    const perto = await criarEmpresa(app, prisma, 'perto@exemplo.com', 'Perto');
    await prisma.empresaEnterprise.update({
      where: { id: perto },
      data: { enderecoCep: '01001000' },
    });
    await servico(perto, 80);
    await servico(perto, 55);
    const tutor = await criarTutor(prisma, 'ana@exemplo.com');
    await prisma.tutor.update({
      where: { id: tutor },
      data: { enderecoCep: '01002000' },
    });
    token = await entrar(app, 'ana@exemplo.com');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('deve ordenar pela distância até o CEP do tutor e guardar as coordenadas', async () => {
    const resposta = await http()
      .get('/v1/empresas?perto=true')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const pagina = resposta.body as Pagina;
    expect(pagina.itens.map((i) => i.nomeFantasia)).toEqual(['Perto', 'Longe']);
    expect(pagina.itens[0]).toMatchObject({
      precoAPartirDe: 55,
      totalAvaliacoes: 0,
    });
    expect(pagina.itens[0].distanciaKm).toBeLessThan(
      pagina.itens[1].distanciaKm!,
    );
    expect(
      await prisma.empresaEnterprise.count({
        where: { latitude: { not: null } },
      }),
    ).toBe(2);
  });

  it('deve ordenar a partir da localização do aparelho e recusar CEP inválido', async () => {
    const resposta = await http()
      .get('/v1/empresas?latitude=-23.74&longitude=-46.82')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((resposta.body as Pagina).itens[0].nomeFantasia).toBe('Longe');
    await http()
      .get('/v1/empresas?cep=123')
      .set('Authorization', `Bearer ${token}`)
      .expect(422);
  });
});
