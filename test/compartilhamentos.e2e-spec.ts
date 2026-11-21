import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { FilaEmailService } from '../src/modulos/notificacao/aplicacao/fila-email.service';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarEmpresa, criarPet, criarTutor, entrar } from './utils/cenario';

interface Compartilhamento {
  id: string;
  status: string;
  link?: string;
}

describe('UC-11 · Compartilhamento do perfil do pet (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let tokenAna: string;
  let tokenClinica: string;
  let clinicaId: string;
  let petId: string;
  let porEmail: Compartilhamento;
  const emails: { tipo: string; dados: unknown }[] = [];

  const http = () => request(app.getHttpServer());
  const como = (t: string, r: request.Test) =>
    r.set('Authorization', `Bearer ${t}`);
  const tokenDoLink = (link: string) => link.split('/compartilhado/')[1];

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    jest
      .spyOn(app.get(FilaEmailService), 'enviar')
      .mockImplementation((tipo, _para, dados) => {
        emails.push({ tipo, dados });
        return Promise.resolve();
      });
    const anaId = await criarTutor(prisma, 'ana@exemplo.com', 'Ana');
    tokenAna = await entrar(app, 'ana@exemplo.com');
    clinicaId = await criarEmpresa(app, prisma, 'clinica@exemplo.com');
    tokenClinica = await entrar(app, 'clinica@exemplo.com');
    petId = await criarPet(prisma, anaId);
    await prisma.alergiaRestricao.create({
      data: {
        petId,
        tipo: 'ALERGIA',
        descricao: 'Frango',
        gravidade: 'GRAVE',
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('CT-11-01: deve compartilhar só vacinas e alergias com um e-mail', async () => {
    const criado = await como(
      tokenAna,
      http()
        .post(`/v1/pets/${petId}/compartilhamentos`)
        .send({
          destinatarioEmail: 'Vet@Exemplo.com',
          escopos: ['VACINAS', 'ALERGIAS'],
        }),
    ).expect(201);
    porEmail = criado.body as Compartilhamento;
    expect(porEmail.status).toBe('ATIVO');
    expect(emails).toEqual([
      expect.objectContaining({
        tipo: 'COMPARTILHAMENTO_PET',
        dados: expect.objectContaining({
          secoes: 'vacinas, alergias e restrições',
        }) as unknown,
      }),
    ]);

    const token = tokenDoLink(porEmail.link!);
    const perfil = await http().get(`/v1/compartilhados/${token}`).expect(200);
    expect(perfil.body).toMatchObject({
      pet: { nome: 'Thor' },
      secoes: ['vacinas', 'alergias'],
    });
    expect(perfil.body).not.toHaveProperty('pet.raca');
    const alergias = await http()
      .get(`/v1/compartilhados/${token}/alergias`)
      .expect(200);
    expect(alergias.body).toEqual([
      expect.objectContaining({ descricao: 'Frango', gravidade: 'GRAVE' }),
    ]);
  });

  it('CT-11-02: deve negar os exames a quem só recebeu vacinas', async () => {
    const token = tokenDoLink(porEmail.link!);
    await http().get(`/v1/compartilhados/${token}/exames`).expect(403);
    await http().get(`/v1/compartilhados/${token}/qualquer`).expect(404);
  });

  it('deve dar à empresa acesso dentro do sistema e cortar o link revogado', async () => {
    await como(tokenClinica, http().get(`/v1/pets/${petId}/vacinacoes`)).expect(
      404,
    );
    await como(
      tokenAna,
      http()
        .post(`/v1/pets/${petId}/compartilhamentos`)
        .send({ empresaId: clinicaId, escopos: ['PERFIL_BASICO', 'VACINAS'] }),
    ).expect(201);
    await como(tokenClinica, http().get(`/v1/pets/${petId}/vacinacoes`)).expect(
      200,
    );

    await como(
      tokenAna,
      http().post(`/v1/compartilhamentos/${porEmail.id}/revogacao`),
    ).expect(204);
    await http()
      .get(`/v1/compartilhados/${tokenDoLink(porEmail.link!)}`)
      .expect(410);
    const lista = await como(
      tokenAna,
      http().get(`/v1/pets/${petId}/compartilhamentos`),
    ).expect(200);
    expect(
      (lista.body as Compartilhamento[]).map((c) => c.status).sort(),
    ).toEqual(['ATIVO', 'REVOGADO']);
  });

  it('deve recusar edição clínica por e-mail e destino duplo', async () => {
    await como(
      tokenAna,
      http()
        .post(`/v1/pets/${petId}/compartilhamentos`)
        .send({ destinatarioEmail: 'a@b.com', escopos: ['EDICAO_CLINICA'] }),
    ).expect(422);
    await como(
      tokenAna,
      http()
        .post(`/v1/pets/${petId}/compartilhamentos`)
        .send({
          destinatarioEmail: 'a@b.com',
          empresaId: clinicaId,
          escopos: ['VACINAS'],
        }),
    ).expect(422);
  });
});
