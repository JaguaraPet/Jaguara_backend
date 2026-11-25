import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarAdministrador, criarTutor, entrar } from './utils/cenario';

interface Perfil {
  id: string;
  nome: string;
  categoria: string;
  permissoes: string[];
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('UC-29 · Permissões globais (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let tokenAdmin: string;
  let tutor: Perfil;

  const http = () => request(app.getHttpServer());
  const como = (t: string, r: request.Test) =>
    r.set('Authorization', `Bearer ${t}`);

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    await criarAdministrador(prisma, 'admin@exemplo.com');
    tokenAdmin = await entrar(app, 'admin@exemplo.com');
    await criarTutor(prisma, 'ana@exemplo.com', 'Ana');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('deve mostrar a matriz dos perfis globais e o catálogo', async () => {
    const perfis = await como(
      tokenAdmin,
      http().get('/v1/admin/perfis'),
    ).expect(200);
    const lista = perfis.body as Perfil[];
    expect(lista.map((p) => p.nome)).toEqual(
      expect.arrayContaining(['Administrador', 'Empresa', 'Tutor']),
    );
    tutor = lista.find((p) => p.nome === 'Tutor')!;
    expect(tutor.categoria).toBe('TUTOR');
    const catalogo = await como(
      tokenAdmin,
      http().get('/v1/admin/permissoes'),
    ).expect(200);
    expect(catalogo.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          codigo: 'privacidade:solicitar',
          categoria: 'TUTOR',
        }),
      ]),
    );
  });

  it('CT-29-01: deve conceder e retirar permissão do perfil Tutor valendo na hora', async () => {
    const semExportar = tutor.permissoes.filter(
      (c) => c !== 'privacidade:solicitar',
    );
    await como(
      tokenAdmin,
      http()
        .put(`/v1/admin/perfis/${tutor.id}`)
        .send({ permissoes: semExportar }),
    ).expect(200);
    const tokenAntes = await entrar(app, 'ana@exemplo.com');
    await como(tokenAntes, http().get('/v1/privacidade/exportacao')).expect(
      403,
    );

    await esperar(1100);
    const concedido = await como(
      tokenAdmin,
      http()
        .put(`/v1/admin/perfis/${tutor.id}`)
        .send({ permissoes: tutor.permissoes }),
    ).expect(200);
    expect((concedido.body as Perfil).permissoes).toContain(
      'privacidade:solicitar',
    );
    // O token antigo deixa de valer; o cliente renova e já recebe a permissão.
    await como(tokenAntes, http().get('/v1/privacidade/exportacao')).expect(
      401,
    );
    const tokenDepois = await entrar(app, 'ana@exemplo.com');
    await como(tokenDepois, http().get('/v1/privacidade/exportacao')).expect(
      200,
    );
  });

  it('CT-29-02: deve rejeitar perfil sem permissão e mistura de categorias', async () => {
    await como(
      tokenAdmin,
      http().put(`/v1/admin/perfis/${tutor.id}`).send({ permissoes: [] }),
    ).expect(422);
    const mistura = await como(
      tokenAdmin,
      http()
        .put(`/v1/admin/perfis/${tutor.id}`)
        .send({ permissoes: ['pet:ler', 'admin:usuarios'] }),
    ).expect(422);
    expect(JSON.stringify(mistura.body)).toContain('admin:usuarios');
    const tokenAna = await entrar(app, 'ana@exemplo.com');
    await como(tokenAna, http().get('/v1/admin/perfis')).expect(403);
  });
});
