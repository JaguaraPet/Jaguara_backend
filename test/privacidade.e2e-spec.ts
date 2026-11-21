import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarPet, criarTutor, entrar, SENHA_TESTE } from './utils/cenario';

interface Situacao {
  termoId: string;
  tipo: string;
  versao: string;
  obrigatorio: boolean;
  aceito: boolean;
}

describe('UC-46 · Privacidade, consentimentos e direitos do titular (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let anaId: string;
  let token: string;
  let tokenCaio: string;
  let petSoDaAna: string;
  let petDividido: string;

  const http = () => request(app.getHttpServer());
  const como = (r: request.Test, t = token) =>
    r.set('Authorization', `Bearer ${t}`);
  const situacoes = async () =>
    (await como(http().get('/v1/privacidade/consentimentos')).expect(200))
      .body as Situacao[];
  const termo = async (tipo: string) =>
    (await situacoes()).find((s) => s.tipo === tipo)!;

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    const termos = [
      ['TERMOS_USO_APP', 'Termos de uso do app', true],
      ['POLITICA_PRIVACIDADE', 'Política de privacidade', true],
      ['COMUNICACAO_MARKETING', 'Comunicações de novidades', false],
    ] as const;
    for (const [tipo, titulo, obrigatorio] of termos) {
      await prisma.termoUso.create({
        data: {
          tipo,
          titulo,
          obrigatorio,
          versao: '1.0',
          conteudo: titulo,
          dataVigencia: new Date('2026-11-01'),
        },
      });
    }
    anaId = await criarTutor(prisma, 'ana@exemplo.com', 'Ana');
    token = await entrar(app, 'ana@exemplo.com');
    const caioId = await criarTutor(prisma, 'caio@exemplo.com', 'Caio');
    tokenCaio = await entrar(app, 'caio@exemplo.com');
    // A Ana aceitou tudo no cadastro.
    const vigentes = await prisma.termoUso.findMany();
    await prisma.consentimento.createMany({
      data: vigentes.map((t) => ({
        usuarioId: anaId,
        termoId: t.id,
        aceito: true,
        dataAceite: new Date('2026-11-02T12:00:00Z'),
        meioColeta: 'ACEITE_NO_APP' as const,
        ipOrigem: '127.0.0.1',
      })),
    });
    petSoDaAna = await criarPet(prisma, anaId, 'Thor');
    petDividido = await criarPet(prisma, anaId, 'Mia');
    await prisma.responsavelPet.create({
      data: {
        petId: petDividido,
        tutorId: caioId,
        tipo: 'ADICIONAL',
        ativo: true,
        dataVinculo: new Date(),
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('deve listar os termos vigentes sem login (RN42)', async () => {
    const termos = await http().get('/v1/termos/vigentes').expect(200);
    expect(
      (termos.body as { tipo: string }[]).map((t) => t.tipo).sort(),
    ).toEqual([
      'COMUNICACAO_MARKETING',
      'POLITICA_PRIVACIDADE',
      'TERMOS_USO_APP',
    ]);
  });

  it('CT-46-01: deve revogar o consentimento opcional com data e auditoria', async () => {
    const marketing = await termo('COMUNICACAO_MARKETING');
    await como(
      http()
        .put('/v1/privacidade/consentimentos')
        .send([{ termoId: marketing.termoId, aceito: false }]),
    ).expect(204);
    expect((await termo('COMUNICACAO_MARKETING')).aceito).toBe(false);
    const registro = await prisma.consentimento.findFirstOrThrow({
      where: { usuarioId: anaId, termoId: marketing.termoId },
    });
    expect(registro.dataRevogacao).not.toBeNull();
    expect(
      await prisma.logAuditoria.count({
        where: { acao: 'CONSENTIMENTO_REVOGADO', autorId: anaId },
      }),
    ).toBe(1);
  });

  it('CT-46-02: deve recusar a revogação do termo obrigatório e sugerir a exclusão', async () => {
    const uso = await termo('TERMOS_USO_APP');
    const resposta = await como(
      http()
        .put('/v1/privacidade/consentimentos')
        .send([{ termoId: uso.termoId, aceito: false }]),
    ).expect(409);
    expect(resposta.body).toMatchObject({ codigo: 'RN25_TERMO_OBRIGATORIO' });
    expect(JSON.stringify(resposta.body)).toContain('excluir a conta');
  });

  it('CT-46-03: deve pedir o aceite da nova versão obrigatória', async () => {
    const nova = await prisma.termoUso.create({
      data: {
        tipo: 'TERMOS_USO_APP',
        titulo: 'Termos de uso do app',
        obrigatorio: true,
        versao: '2.0',
        conteudo: 'Versão 2.0',
        dataVigencia: new Date(Date.now() - 86_400_000),
      },
    });
    const pendente = await termo('TERMOS_USO_APP');
    expect(pendente).toMatchObject({ versao: '2.0', aceito: false });
    await como(
      http()
        .put('/v1/privacidade/consentimentos')
        .send([{ termoId: nova.id, aceito: true }]),
    ).expect(204);
    expect(await termo('TERMOS_USO_APP')).toMatchObject({
      versao: '2.0',
      aceito: true,
    });
  });

  it('deve exportar os dados do titular com os pets', async () => {
    const solicitacao = await como(
      http()
        .post('/v1/privacidade/solicitacoes')
        .send({ tipo: 'EXPORTACAO_DADOS' }),
    ).expect(202);
    expect(solicitacao.body).toMatchObject({ status: 'CONCLUIDA' });
    const dados = await como(http().get('/v1/privacidade/exportacao')).expect(
      200,
    );
    expect(dados.body).toMatchObject({
      conta: { email: 'ana@exemplo.com', nome: 'Ana' },
    });
    expect(
      (dados.body as { pets: { nome: string }[] }).pets
        .map((p) => p.nome)
        .sort(),
    ).toEqual(['Mia', 'Thor']);
  });

  it('deve excluir a conta só com a senha, anonimizar e passar o pet dividido', async () => {
    await como(
      http()
        .post('/v1/privacidade/solicitacoes')
        .send({ tipo: 'EXCLUSAO_DADOS' }),
    ).expect(422);
    await como(
      http()
        .post('/v1/privacidade/solicitacoes')
        .send({ tipo: 'EXCLUSAO_DADOS', senha: 'senha-errada' }),
    ).expect(422);
    await como(
      http()
        .post('/v1/privacidade/solicitacoes')
        .send({ tipo: 'EXCLUSAO_DADOS', senha: SENHA_TESTE }),
    ).expect(202);

    const conta = await prisma.usuario.findUniqueOrThrow({
      where: { id: anaId },
    });
    expect(conta.email).toBe(`excluido-${anaId}@anonimo.jaguara`);
    expect(conta.status).toBe('INATIVA');
    expect(
      (await prisma.pet.findUniqueOrThrow({ where: { id: petSoDaAna } })).nome,
    ).toBe('Pet removido');
    const mia = await como(
      http().get(`/v1/pets/${petDividido}`),
      tokenCaio,
    ).expect(200);
    expect(mia.body).toMatchObject({ nome: 'Mia' });
    expect(
      await prisma.responsavelPet.findFirst({
        where: { petId: petDividido, tipo: 'PRINCIPAL', ativo: true },
      }),
    ).toMatchObject({ tutorId: expect.not.stringContaining(anaId) as unknown });
    // A sessão da Ana foi encerrada.
    await como(http().get('/v1/privacidade/consentimentos')).expect(401);
  });
});
