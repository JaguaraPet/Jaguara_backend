import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import {
  compartilhar,
  criarEmpresa,
  criarPet,
  criarProfissional,
  criarTutor,
  entrar,
} from './utils/cenario';

interface Vinculado {
  id: string;
  nome: string;
  motivos: string[];
  secoes: string[];
}

describe('UC-20 e UC-22 · Pets vinculados e perfil para a empresa (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let empresaId: string;
  let token: string;
  let tokenOutra: string;
  let thor: string;
  let mia: string;
  let rex: string;

  const http = () => request(app.getHttpServer());
  const como = (t: string, r: request.Test) =>
    r.set('Authorization', `Bearer ${t}`);

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    empresaId = await criarEmpresa(app, prisma, 'clinica@exemplo.com');
    await criarProfissional(prisma, empresaId, 'vet@exemplo.com');
    token = await entrar(app, 'vet@exemplo.com');
    await criarEmpresa(app, prisma, 'outra@exemplo.com', 'Outra');
    tokenOutra = await entrar(app, 'outra@exemplo.com');
    const anaId = await criarTutor(prisma, 'ana@exemplo.com', 'Ana');
    thor = await criarPet(prisma, anaId, 'Thor');
    mia = await criarPet(prisma, anaId, 'Mia');
    rex = await criarPet(prisma, anaId, 'Rex');
    await compartilhar(prisma, thor, empresaId, ['PERFIL_BASICO', 'VACINAS']);
    const servico = await prisma.servico.create({
      data: {
        empresaId,
        nome: 'Consulta',
        descricao: 'Consulta',
        categoria: 'CONSULTA',
        preco: 150,
        duracaoMinutos: 30,
        ativo: true,
      },
    });
    await prisma.agendamento.create({
      data: {
        servicoId: servico.id,
        petId: mia,
        dataHoraInicio: new Date(Date.now() + 86_400_000),
        dataHoraFim: new Date(Date.now() + 86_400_000 + 1_800_000),
        precoContratado: 150,
        status: 'AGENDADO',
        criadoEm: new Date(),
      },
    });
    await prisma.registroClinico.create({
      data: {
        petId: thor,
        registradoPorId: anaId,
        dataRegistro: new Date(),
        valido: true,
        vacinacao: {
          create: {
            nomeVacina: 'V10',
            dataAplicacao: new Date('2026-10-01'),
            responsavelAplicacao: 'Dra. Júlia',
          },
        },
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('CT-20-01: deve listar só os pets com compartilhamento ou agendamento', async () => {
    const resposta = await como(
      token,
      http().get(`/v1/empresas/${empresaId}/pets-vinculados`),
    ).expect(200);
    const lista = resposta.body as Vinculado[];
    expect(lista.map((p) => [p.nome, p.motivos])).toEqual([
      ['Mia', ['AGENDAMENTO']],
      ['Thor', ['COMPARTILHAMENTO']],
    ]);
    await como(
      tokenOutra,
      http().get(`/v1/empresas/${empresaId}/pets-vinculados`),
    ).expect(403);
  });

  it('CT-22-01: deve mostrar só as seções liberadas pelo tutor', async () => {
    const resposta = await como(
      token,
      http().get(`/v1/empresas/${empresaId}/pets/${thor}/perfil`),
    ).expect(200);
    expect(resposta.body).toMatchObject({
      nome: 'Thor',
      secoes: ['vacinas'],
      vacinas: [expect.objectContaining({ nomeVacina: 'V10' })],
    });
    expect(resposta.body).not.toHaveProperty('exames');
  });

  it('CT-20-02 e CT-22-02: deve negar o pet sem vínculo com a empresa', async () => {
    await como(
      token,
      http().get(`/v1/empresas/${empresaId}/pets/${rex}/perfil`),
    ).expect(403);
    await como(token, http().get(`/v1/pets/${rex}`)).expect(403);
  });
});
