import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { FilaEmailService } from '../src/modulos/notificacao/aplicacao/fila-email.service';
import {
  hojeBrasilia,
  somarDias,
} from '../src/modulos/notificacao/dominio/lembretes';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';

/**
 * Integração de ponta a ponta na API (JAG-120): o tutor e a empresa se cadastram pela API,
 * confirmam o e-mail, o tutor cuida da saúde do pet e compartilha só o que quer com a empresa.
 */
describe('Integração · acesso, pets e saúde (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  const links: string[] = [];
  let tutor: { accessToken: string; refreshToken: string };
  let empresa: { accessToken: string };
  let empresaId: string;
  let petId: string;
  let compartilhamentoId: string;

  const http = () => request(app.getHttpServer());
  const como = (t: string, r: request.Test) =>
    r.set('Authorization', `Bearer ${t}`);
  /** Status esperado, com o corpo do erro na mensagem quando falha. */
  const status = (esperado: number) => (r: request.Response) => {
    if (r.status !== esperado) {
      throw new Error(`${r.status}: ${JSON.stringify(r.body)}`);
    }
  };
  const ultimoToken = () =>
    decodeURIComponent(links[links.length - 1].split('token=')[1]);

  async function cadastrarEConfirmar(rota: string, corpo: object) {
    await http().post(rota).send(corpo).expect(201);
    await http()
      .post('/v1/auth/confirmacao')
      .send({ token: ultimoToken() })
      .expect(204);
  }

  async function entrar(email: string) {
    const r = await http()
      .post('/v1/auth/login')
      .send({ email, senha: 'senhaForte1' })
      .expect(200);
    return r.body as { accessToken: string; refreshToken: string };
  }

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    jest
      .spyOn(app.get(FilaEmailService), 'enviar')
      .mockImplementation((_tipo, _para, dados) => {
        const link = (dados as { link?: string }).link;
        if (link) links.push(link);
        return Promise.resolve();
      });
    for (const tipo of [
      'TERMOS_USO_APP',
      'TERMOS_ENTERPRISE',
      'POLITICA_PRIVACIDADE',
    ] as const) {
      await prisma.termoUso.create({
        data: {
          tipo,
          versao: '1.0',
          titulo: tipo,
          conteudo: 'Texto',
          dataVigencia: new Date('2026-11-01'),
          obrigatorio: true,
        },
      });
    }
    const especie = await prisma.especie.create({ data: { nome: 'Cachorro' } });
    await prisma.raca.create({ data: { nome: 'SRD', especieId: especie.id } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('acesso: tutor e empresa se cadastram, confirmam o e-mail e entram', async () => {
    await cadastrarEConfirmar('/v1/auth/cadastro/tutor', {
      nome: 'Ana Ribeiro',
      cpf: '52998224725',
      email: 'ana@exemplo.com',
      senha: 'senhaForte1',
      aceiteTermos: true,
    });
    tutor = await entrar('ana@exemplo.com');

    await cadastrarEConfirmar('/v1/auth/cadastro/empresa', {
      cnpj: '11222333000181',
      razaoSocial: 'Clínica Patas Ltda.',
      nomeFantasia: 'Clínica Patas',
      tipo: 'CLINICA_VETERINARIA',
      email: 'clinica@exemplo.com',
      senha: 'senhaForte1',
      endereco: {
        cep: '05400000',
        logradouro: 'Rua A',
        numero: '10',
        bairro: 'Centro',
        cidade: 'São Paulo',
        uf: 'SP',
      },
      aceiteTermos: true,
    });
    empresa = await entrar('clinica@exemplo.com');
    const conta = await prisma.usuario.findUniqueOrThrow({
      where: { email: 'clinica@exemplo.com' },
    });
    empresaId = conta.id;
  });

  it('pets: o tutor cadastra, consulta e altera o pet', async () => {
    const especies = await como(
      tutor.accessToken,
      http().get('/v1/especies'),
    ).expect(200);
    const racaId = (especies.body as { racas: { id: string }[] }[])[0].racas[0]
      .id;
    const criado = await como(
      tutor.accessToken,
      http().post('/v1/pets').send({
        nome: 'Thor',
        racaId,
        sexo: 'MACHO',
        dataNascimento: '2022-03-10',
        castrado: false,
      }),
    ).expect(201);
    petId = (criado.body as { id: string }).id;

    await como(
      tutor.accessToken,
      http().patch(`/v1/pets/${petId}`).send({
        nome: 'Thor',
        racaId,
        sexo: 'MACHO',
        dataNascimento: '2022-03-10',
        pesoKg: 12.5,
        castrado: true,
      }),
    ).expect(status(200));
    const pet = await como(
      tutor.accessToken,
      http().get(`/v1/pets/${petId}`),
    ).expect(200);
    expect(pet.body).toMatchObject({
      nome: 'Thor',
      pesoKg: 12.5,
      castrado: true,
    });
    const lista = await como(tutor.accessToken, http().get('/v1/pets')).expect(
      200,
    );
    expect((lista.body as { total: number }).total).toBe(1);
  });

  it('saúde: vacina, alergia grave e tratamento aparecem na linha do tempo', async () => {
    await como(
      tutor.accessToken,
      http()
        .post(`/v1/pets/${petId}/vacinacoes`)
        .send({
          nomeVacina: 'V10',
          dataAplicacao: somarDias(hojeBrasilia(), -10),
          dataProximaDose: somarDias(hojeBrasilia(), 355),
          responsavelAplicacao: 'Dra. Júlia',
        }),
    ).expect(status(201));
    await como(
      tutor.accessToken,
      http().post(`/v1/pets/${petId}/alergias`).send({
        tipo: 'RESTRICAO_MEDICAMENTOSA',
        descricao: 'Dipirona',
        gravidade: 'GRAVE',
      }),
    ).expect(status(201));
    await como(
      tutor.accessToken,
      http()
        .post(`/v1/pets/${petId}/tratamentos`)
        .send({
          medicamento: 'Vermífugo',
          dosagem: '1 comprimido',
          viaAdministracao: 'Oral',
          intervaloHoras: 24,
          dataInicio: hojeBrasilia(),
          dataFim: somarDias(hojeBrasilia(), 2),
        }),
    ).expect(status(201));

    const alergias = await como(
      tutor.accessToken,
      http().get(`/v1/pets/${petId}/alergias`),
    ).expect(200);
    expect(alergias.body).toEqual([
      expect.objectContaining({ descricao: 'Dipirona', destaque: true }),
    ]);
    const linha = await como(
      tutor.accessToken,
      http().get(`/v1/pets/${petId}/linha-do-tempo`),
    ).expect(200);
    const titulos = (linha.body as { titulo: string }[]).map((i) => i.titulo);
    expect(titulos).toEqual(
      expect.arrayContaining(['Vacina V10', 'Início do tratamento: Vermífugo']),
    );
    expect(
      await prisma.notificacao.count({ where: { status: 'AGENDADA' } }),
    ).toBeGreaterThan(0);
  });

  it('compartilhamento: a empresa vê só o escopo liberado e perde o acesso na revogação', async () => {
    // Sem compartilhamento, a empresa não vê o pet.
    await como(
      empresa.accessToken,
      http().get(`/v1/pets/${petId}/vacinacoes`),
    ).expect(404);

    const compartilhado = await como(
      tutor.accessToken,
      http()
        .post(`/v1/pets/${petId}/compartilhamentos`)
        .send({ empresaId, escopos: ['PERFIL_BASICO', 'VACINAS'] }),
    ).expect(201);
    compartilhamentoId = (compartilhado.body as { id: string }).id;

    const vacinas = await como(
      empresa.accessToken,
      http().get(`/v1/pets/${petId}/vacinacoes`),
    ).expect(200);
    expect(vacinas.body).toEqual([
      expect.objectContaining({ nomeVacina: 'V10' }),
    ]);
    await como(
      empresa.accessToken,
      http().get(`/v1/pets/${petId}/alergias`),
    ).expect(403);
    const perfil = await como(
      empresa.accessToken,
      http().get(`/v1/empresas/${empresaId}/pets/${petId}/perfil`),
    ).expect(200);
    expect(perfil.body).toMatchObject({ secoes: ['vacinas'] });

    await como(
      tutor.accessToken,
      http().post(`/v1/compartilhamentos/${compartilhamentoId}/revogacao`),
    ).expect((r) => expect([200, 204]).toContain(r.status));
    await como(
      empresa.accessToken,
      http().get(`/v1/empresas/${empresaId}/pets/${petId}/perfil`),
    ).expect(403);
  });

  it('sessão: renova o token e o logout encerra o acesso', async () => {
    const renovado = await http()
      .post('/v1/auth/renovacao')
      .send({ refreshToken: tutor.refreshToken })
      .expect(200);
    const novo = renovado.body as { accessToken: string; refreshToken: string };
    await http()
      .post('/v1/auth/renovacao')
      .send({ refreshToken: tutor.refreshToken })
      .expect(401);
    await como(novo.accessToken, http().post('/v1/auth/logout')).expect(204);
    await como(novo.accessToken, http().get('/v1/pets')).expect(401);
  });
});
