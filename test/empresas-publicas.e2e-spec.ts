import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarEmpresa, criarTutor, entrar } from './utils/cenario';

interface Pagina {
  itens: {
    id: string;
    nomeFantasia: string;
    categorias: string[];
    cidade: string;
  }[];
  total: number;
}

describe('UC-33 · Catálogo público das empresas (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let tokenTutor: string;
  let clinica: string;
  let semServicos: string;

  const buscar = async (query = '') =>
    (
      await request(app.getHttpServer())
        .get(`/v1/empresas${query}`)
        .set('Authorization', `Bearer ${tokenTutor}`)
        .expect(200)
    ).body as Pagina;

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    clinica = await criarEmpresa(
      app,
      prisma,
      'patas@exemplo.com',
      'Clínica Patas',
    );
    const petshop = await criarEmpresa(
      app,
      prisma,
      'cheiroso@exemplo.com',
      'Pet Shop Cheiroso',
    );
    semServicos = await criarEmpresa(
      app,
      prisma,
      'vazia@exemplo.com',
      'Empresa Sem Serviços',
    );
    await prisma.empresaEnterprise.update({
      where: { id: petshop },
      data: { tipo: 'PET_SHOP', enderecoCidade: 'Campinas' },
    });
    const servico = (
      empresaId: string,
      nome: string,
      categoria: 'CONSULTA' | 'BANHO_TOSA',
      ativo = true,
    ) =>
      prisma.servico.create({
        data: {
          empresaId,
          nome,
          descricao: nome,
          categoria,
          preco: 100,
          duracaoMinutos: 30,
          ativo,
        },
      });
    await servico(clinica, 'Consulta clínica', 'CONSULTA');
    await servico(petshop, 'Banho e tosa', 'BANHO_TOSA');
    await servico(semServicos, 'Serviço desativado', 'CONSULTA', false);
    await criarTutor(prisma, 'tutor@exemplo.com');
    tokenTutor = await entrar(app, 'tutor@exemplo.com');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('deve listar só empresas com serviços ativos', async () => {
    const pagina = await buscar();
    expect(pagina.total).toBe(2);
    expect(pagina.itens.map((e) => e.nomeFantasia)).toEqual([
      'Clínica Patas',
      'Pet Shop Cheiroso',
    ]);
  });

  it('deve filtrar por nome de serviço, tipo, categoria e cidade', async () => {
    expect(
      (await buscar('?busca=tosa')).itens.map((e) => e.nomeFantasia),
    ).toEqual(['Pet Shop Cheiroso']);
    expect(
      (await buscar('?tipo=CLINICA_VETERINARIA')).itens.map(
        (e) => e.nomeFantasia,
      ),
    ).toEqual(['Clínica Patas']);
    expect((await buscar('?categoria=BANHO_TOSA')).total).toBe(1);
    expect((await buscar('?cidade=campinas')).itens[0]).toMatchObject({
      cidade: 'Campinas',
      categorias: ['BANHO_TOSA'],
    });
  });

  it('CT-33-01: deve mostrar nome, descrição, valor e duração dos serviços quando o tutor abre o catálogo', async () => {
    const perfil = await request(app.getHttpServer())
      .get(`/v1/empresas/${clinica}`)
      .set('Authorization', `Bearer ${tokenTutor}`)
      .expect(200);
    expect(perfil.body).not.toHaveProperty('cnpj');
    const catalogo = await request(app.getHttpServer())
      .get(`/v1/empresas/${clinica}/servicos`)
      .set('Authorization', `Bearer ${tokenTutor}`)
      .expect(200);
    expect(catalogo.body).toEqual([
      expect.objectContaining({
        nome: 'Consulta clínica',
        descricao: 'Consulta clínica',
        preco: 100,
        duracaoMinutos: 30,
      }),
    ]);
  });

  it('CT-33-02: deve devolver catálogo vazio quando a empresa não tem serviços ativos', async () => {
    const catalogo = await request(app.getHttpServer())
      .get(`/v1/empresas/${semServicos}/servicos`)
      .set('Authorization', `Bearer ${tokenTutor}`)
      .expect(200);
    expect(catalogo.body).toEqual([]);
  });
});
