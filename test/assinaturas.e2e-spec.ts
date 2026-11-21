import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarTutor, entrar } from './utils/cenario';

interface Situacao {
  plano: string;
  vigente: boolean;
  assinatura?: { id: string; status: string; dataFim?: string };
  precoMensal: number;
}

describe('Assinatura do plano PANTERA (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let token: string;
  let assinaturaId: string;

  const http = () => request(app.getHttpServer());
  const como = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const situacao = async () =>
    (await como(http().get('/v1/assinaturas/atual')).expect(200))
      .body as Situacao;

  beforeAll(async () => {
    delete process.env.MP_ACCESS_TOKEN;
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    await criarTutor(prisma, 'ana@exemplo.com', 'Ana');
    token = await entrar(app, 'ana@exemplo.com');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('deve começar no plano gratuito, sem acesso ao assistente', async () => {
    expect(await situacao()).toMatchObject({
      plano: 'GRATUITO',
      vigente: false,
      precoMensal: 14.9,
    });
    await como(
      http().post('/v1/conversas').send({ tipo: 'ASSISTENTE_VIRTUAL' }),
    ).expect(402);
  });

  it('deve criar a assinatura pendente e ativar só com o pagamento confirmado (RN39)', async () => {
    const criada = await como(http().post('/v1/assinaturas')).expect(201);
    assinaturaId = (criada.body as { id: string }).id;
    expect(criada.body).toMatchObject({ status: 'PENDENTE' });
    // Pedir de novo devolve a mesma pendente.
    const repetida = await como(http().post('/v1/assinaturas')).expect(201);
    expect((repetida.body as { id: string }).id).toBe(assinaturaId);
    expect((await situacao()).vigente).toBe(false);

    const pagamento = await como(
      http().post('/v1/pagamentos').send({
        assinaturaId,
        metodo: 'CARTAO_CREDITO',
        tokenCartao: 'cartao-teste-aprovado',
        bandeiraCartao: 'visa',
      }),
    ).expect(201);
    expect(pagamento.body).toMatchObject({ status: 'ACEITO', valor: 14.9 });

    const atual = await situacao();
    expect(atual).toMatchObject({
      plano: 'PANTERA',
      vigente: true,
      assinatura: { id: assinaturaId, status: 'ATIVA' },
    });
    await como(
      http().post('/v1/conversas').send({ tipo: 'ASSISTENTE_VIRTUAL' }),
    ).expect(201);
  });

  it('deve manter o acesso até o fim do período depois do cancelamento', async () => {
    const cancelada = await como(
      http().post('/v1/assinaturas/atual/cancelamento'),
    ).expect(201);
    expect(cancelada.body).toMatchObject({ status: 'CANCELADA' });
    expect(await situacao()).toMatchObject({ plano: 'PANTERA', vigente: true });
    await como(http().post('/v1/assinaturas/atual/cancelamento')).expect(409);
    await como(
      http().post('/v1/pagamentos').send({ assinaturaId, metodo: 'PIX' }),
    ).expect(409);
  });
});
