import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { FilaEmailService } from '../src/modulos/notificacao/aplicacao/fila-email.service';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarTutor, entrar, SENHA_TESTE } from './utils/cenario';

describe('UC-03 · Recuperação de senha (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let anaId: string;
  const links: string[] = [];

  const http = () => request(app.getHttpServer());
  const pedir = (email: string) =>
    http().post('/v1/auth/senha/recuperacao').send({ email }).expect(202);
  const tokenDoUltimoLink = () =>
    decodeURIComponent(links[links.length - 1].split('token=')[1]);
  const redefinir = (token: string, novaSenha: string) =>
    http().post('/v1/auth/senha/redefinicao').send({ token, novaSenha });

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    jest
      .spyOn(app.get(FilaEmailService), 'enviar')
      .mockImplementation((_tipo, _para, dados) => {
        links.push((dados as { link: string }).link);
        return Promise.resolve();
      });
    anaId = await criarTutor(prisma, 'ana@exemplo.com', 'Ana');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('não deve revelar se o e-mail tem conta', async () => {
    await pedir('ninguem@exemplo.com');
    expect(links).toHaveLength(0);
  });

  it('CT-03-01: deve trocar a senha com o link de menos de 2 horas e invalidar o link', async () => {
    const sessaoAntiga = await entrar(app, 'ana@exemplo.com');
    await pedir('Ana@Exemplo.com');
    expect(links[0]).toContain('/redefinir-senha?token=');
    const token = tokenDoUltimoLink();

    // RN06: a senha atual é uma das três últimas.
    await redefinir(token, SENHA_TESTE).expect(422);
    await redefinir(token, 'curta').expect(422);
    await redefinir(token, 'novaSenha2026').expect(204);

    await http()
      .post('/v1/auth/login')
      .send({ email: 'ana@exemplo.com', senha: 'novaSenha2026' })
      .expect(200);
    await http()
      .post('/v1/auth/login')
      .send({ email: 'ana@exemplo.com', senha: SENHA_TESTE })
      .expect(401);
    // O link vale uma vez e as sessões antigas caem.
    await redefinir(token, 'outraSenha2026').expect(410);
    await http()
      .get('/v1/privacidade/consentimentos')
      .set('Authorization', `Bearer ${sessaoAntiga}`)
      .expect(401);
  });

  it('CT-03-02: deve recusar o link com mais de 2 horas e orientar a pedir outro', async () => {
    await pedir('ana@exemplo.com');
    const token = tokenDoUltimoLink();
    await prisma.tokenAcesso.updateMany({
      where: { usuarioId: anaId, tipo: 'RECUPERACAO_SENHA', utilizado: false },
      data: { expiraEm: new Date(Date.now() - 60_000) },
    });
    const resposta = await redefinir(token, 'outraSenha2026').expect(410);
    expect(resposta.body).toMatchObject({ codigo: 'LINK_EXPIRADO' });
  });

  it('deve invalidar o link anterior quando um novo é pedido', async () => {
    await pedir('ana@exemplo.com');
    const primeiro = tokenDoUltimoLink();
    await pedir('ana@exemplo.com');
    const segundo = tokenDoUltimoLink();
    await redefinir(primeiro, 'outraSenha2026').expect(410);
    await redefinir(segundo, 'outraSenha2026').expect(204);
  });
});
