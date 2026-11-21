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
  criarTutor,
  entrar,
} from './utils/cenario';

interface Vacinacao {
  id: string;
  nomeVacina: string;
  dataAplicacao: string;
}

describe('UC-12 e UC-13 · Vacinação do pet (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let anaId: string;
  let tokenAna: string;
  let tokenBia: string;
  let tokenClinica: string;
  let petId: string;

  const http = () => request(app.getHttpServer());
  const como = (t: string, r: request.Test) =>
    r.set('Authorization', `Bearer ${t}`);
  const vacinar = (token: string, corpo: object) =>
    como(token, http().post(`/v1/pets/${petId}/vacinacoes`).send(corpo));

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    anaId = await criarTutor(prisma, 'ana@exemplo.com', 'Ana');
    tokenAna = await entrar(app, 'ana@exemplo.com');
    await criarTutor(prisma, 'bia@exemplo.com', 'Bia');
    tokenBia = await entrar(app, 'bia@exemplo.com');
    const clinicaId = await criarEmpresa(app, prisma, 'clinica@exemplo.com');
    tokenClinica = await entrar(app, 'clinica@exemplo.com');
    petId = await criarPet(prisma, anaId);
    await compartilhar(prisma, petId, clinicaId, ['PERFIL_BASICO', 'VACINAS']);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('CT-13-01: deve registrar a vacinação e agendar o lembrete da próxima dose', async () => {
    const proxima = new Date(Date.now() + 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const criada = await vacinar(tokenAna, {
      nomeVacina: 'V10',
      fabricante: 'Zoetis',
      lote: 'L123',
      dataAplicacao: '2026-10-01',
      dataProximaDose: proxima,
      responsavelAplicacao: 'Dra. Júlia',
    }).expect(201);
    expect(criada.body).toMatchObject({ nomeVacina: 'V10', valido: true });
    const lembrete = await prisma.notificacao.findFirstOrThrow({
      where: { origemId: (criada.body as Vacinacao).id },
    });
    expect(lembrete).toMatchObject({
      destinatarioId: anaId,
      status: 'AGENDADA',
      origemTipo: 'VACINACAO',
    });
  });

  it('CT-13-02: deve rejeitar a vacinação sem o responsável pela aplicação', async () => {
    const resposta = await vacinar(tokenAna, {
      nomeVacina: 'Antirrábica',
      dataAplicacao: '2026-10-02',
    }).expect(422);
    expect(JSON.stringify(resposta.body)).toContain('responsavelAplicacao');
  });

  it('CT-12-01 e CT-12-02: deve listar só as válidas em ordem de aplicação', async () => {
    await vacinar(tokenAna, {
      nomeVacina: 'Antirrábica',
      dataAplicacao: '2026-09-01',
      responsavelAplicacao: 'Dra. Júlia',
    }).expect(201);
    const invalida = await vacinar(tokenAna, {
      nomeVacina: 'Gripe canina',
      dataAplicacao: '2026-08-01',
      responsavelAplicacao: 'Clínica X',
    }).expect(201);
    await prisma.registroClinico.update({
      where: { id: (invalida.body as Vacinacao).id },
      data: { valido: false },
    });
    const lista = await como(
      tokenAna,
      http().get(`/v1/pets/${petId}/vacinacoes`),
    ).expect(200);
    expect((lista.body as Vacinacao[]).map((v) => v.nomeVacina)).toEqual([
      'Antirrábica',
      'V10',
    ]);
  });

  it('deve deixar a empresa ler com o escopo VACINAS, mas não registrar sem EDICAO_CLINICA', async () => {
    await como(tokenClinica, http().get(`/v1/pets/${petId}/vacinacoes`)).expect(
      200,
    );
    await vacinar(tokenClinica, {
      nomeVacina: 'V10',
      dataAplicacao: '2026-11-01',
      responsavelAplicacao: 'Dra. Júlia',
    }).expect(403);
    await como(tokenBia, http().get(`/v1/pets/${petId}/vacinacoes`)).expect(
      404,
    );
  });
});
