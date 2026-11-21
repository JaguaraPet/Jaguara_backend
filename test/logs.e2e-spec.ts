import { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarEmpresa, entrar, SENHA_TESTE } from './utils/cenario';

interface Log {
  acao: string;
  nivel: string;
  entidadeId: string;
}

describe('UC-25 · Monitoramento e logs de auditoria (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let tokenAdmin: string;
  let tokenEmpresa: string;

  const logs = async (query = '') =>
    (
      await request(app.getHttpServer())
        .get(`/v1/admin/logs${query}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200)
    ).body as Log[];

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    const perfilAdmin = await prisma.perfilAcesso.findFirstOrThrow({
      where: { nome: 'Administrador', escopo: 'GLOBAL' },
    });
    const admin = await prisma.usuario.create({
      data: {
        email: 'admin@exemplo.com',
        senhaHash: await hash(SENHA_TESTE),
        emailConfirmado: true,
        status: 'ATIVA',
        tentativasLoginFalhas: 0,
        dataCadastro: new Date(),
        perfilId: perfilAdmin.id,
      },
    });
    await prisma.administrador.create({
      data: { id: admin.id, nome: 'Admin' },
    });
    await criarEmpresa(app, prisma, 'empresa@exemplo.com');
    tokenAdmin = await entrar(app, 'admin@exemplo.com');
    tokenEmpresa = await entrar(app, 'empresa@exemplo.com');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('CT-25-02: deve devolver lista vazia quando não há logs para o filtro', async () => {
    expect(await logs('?nivel=CRITICO')).toEqual([]);
  });

  it('CT-25-01: deve listar os logs do período quando o administrador filtra por nível', async () => {
    // Cinco senhas erradas bloqueiam a conta e geram um alerta (RN03, RN31).
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ email: 'empresa@exemplo.com', senha: 'errada' });
    }
    await new Promise((r) => setTimeout(r, 200));
    const alertas = await logs('?nivel=ALERTA');
    expect(alertas).toEqual([
      expect.objectContaining({ acao: 'CONTA_BLOQUEADA', nivel: 'ALERTA' }),
    ]);

    const amanha = new Date(Date.now() + 86_400_000).toISOString();
    expect(await logs(`?de=${encodeURIComponent(amanha)}`)).toEqual([]);
  });

  it('deve negar os logs para quem não é administrador', async () => {
    await request(app.getHttpServer())
      .get('/v1/admin/logs')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .expect(403);
  });
});
