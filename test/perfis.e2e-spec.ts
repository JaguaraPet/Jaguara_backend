import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarEmpresa, criarProfissional, entrar } from './utils/cenario';

interface Perfil {
  id: string;
  nome: string;
  permissoes: string[];
}

describe('UC-16 · Perfis e permissões da empresa (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let empresaId: string;
  let outraId: string;
  let tokenEmpresa: string;
  let vetId: string;
  let gerente: Perfil;

  const http = () => request(app.getHttpServer());
  const como = (t: string, r: request.Test) =>
    r.set('Authorization', `Bearer ${t}`);
  const indicadores = () =>
    http().get(
      `/v1/empresas/${empresaId}/indicadores?de=2026-11-01&ate=2026-11-30`,
    );

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    empresaId = await criarEmpresa(app, prisma, 'clinica@exemplo.com');
    tokenEmpresa = await entrar(app, 'clinica@exemplo.com');
    vetId = await criarProfissional(prisma, empresaId, 'vet@exemplo.com');
    outraId = await criarEmpresa(app, prisma, 'outra@exemplo.com', 'Outra');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('deve listar as permissões que a empresa pode distribuir', async () => {
    const resposta = await como(
      tokenEmpresa,
      http().get(`/v1/empresas/${empresaId}/permissoes`),
    ).expect(200);
    const codigos = (resposta.body as { codigo: string }[]).map(
      (p) => p.codigo,
    );
    expect(codigos).toContain('relatorio:ler');
    expect(codigos).not.toContain('admin:usuarios');
  });

  it('CT-16-01: deve criar o perfil e as permissões valerem para o funcionário', async () => {
    const tokenVet = await entrar(app, 'vet@exemplo.com');
    await como(tokenVet, indicadores()).expect(403);

    const criado = await como(
      tokenEmpresa,
      http()
        .post(`/v1/empresas/${empresaId}/perfis`)
        .send({
          nome: 'Gerente',
          descricao: 'Agenda e indicadores',
          permissoes: ['agenda:ler', 'relatorio:ler'],
        }),
    ).expect(201);
    gerente = criado.body as Perfil;
    expect(gerente.permissoes).toEqual(['agenda:ler', 'relatorio:ler']);

    await como(
      tokenEmpresa,
      http().patch(`/v1/funcionarios/${vetId}`).send({ perfilId: gerente.id }),
    ).expect(200);
    const novoToken = await entrar(app, 'vet@exemplo.com');
    await como(novoToken, indicadores()).expect(200);
  });

  it('deve tirar a permissão na hora quando o perfil muda', async () => {
    const tokenVet = await entrar(app, 'vet@exemplo.com');
    await como(
      tokenEmpresa,
      http()
        .put(`/v1/perfis/${gerente.id}`)
        .send({ nome: 'Gerente', permissoes: ['agenda:ler'] }),
    ).expect(200);
    await como(tokenVet, indicadores()).expect(401);
    const novoToken = await entrar(app, 'vet@exemplo.com');
    await como(novoToken, indicadores()).expect(403);
  });

  it('CT-16-02: deve recusar perfil que a empresa não definiu', async () => {
    const deOutra = await prisma.perfilAcesso.findFirstOrThrow({
      where: { empresaId: outraId },
    });
    await como(
      tokenEmpresa,
      http().patch(`/v1/funcionarios/${vetId}`).send({ perfilId: deOutra.id }),
    ).expect(422);
    await como(
      tokenEmpresa,
      http()
        .post(`/v1/empresas/${empresaId}/perfis`)
        .send({ nome: 'Admin', permissoes: ['admin:usuarios'] }),
    ).expect(422);
  });

  it('deve proteger o Proprietário e o perfil em uso', async () => {
    const proprietario = await prisma.perfilAcesso.findFirstOrThrow({
      where: { empresaId, nome: 'Proprietário' },
    });
    const protegido = await como(
      tokenEmpresa,
      http().delete(`/v1/perfis/${proprietario.id}`),
    ).expect(409);
    expect(protegido.body).toMatchObject({ codigo: 'PERFIL_PROTEGIDO' });
    const emUso = await como(
      tokenEmpresa,
      http().delete(`/v1/perfis/${gerente.id}`),
    ).expect(409);
    expect(emUso.body).toMatchObject({ codigo: 'PERFIL_EM_USO' });
    const tokenVet = await entrar(app, 'vet@exemplo.com');
    await como(
      tokenVet,
      http()
        .post(`/v1/empresas/${empresaId}/perfis`)
        .send({ nome: 'Outro', permissoes: ['agenda:ler'] }),
    ).expect(403);
  });
});
