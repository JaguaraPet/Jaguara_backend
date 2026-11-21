import { INestApplication } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarEmpresa, criarTutor, entrar } from './utils/cenario';

interface Mensagem {
  id: string;
  conversaId: string;
  conteudo: string;
  remetenteId: string | null;
  lida: boolean;
}

describe('UC-43 · Chat em tempo real (API e WebSocket)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let url: string;
  let empresaId: string;
  let anaId: string;
  let tokenEmpresa: string;
  let tokenAna: string;
  let tokenBia: string;
  let conversaId: string;
  let assistenteId: string;
  const sockets: Socket[] = [];

  const http = () => request(app.getHttpServer());
  const como = (token: string, r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`);

  /** Conecta no namespace /tempo-real e espera a confirmação do servidor. */
  const conectar = async (token?: string) => {
    const socket = io(`${url}/tempo-real`, {
      auth: token ? { token } : {},
      transports: ['websocket'],
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('conectado', () => resolve());
      socket.once('erro', (e: { codigo: string }) =>
        reject(new Error(e.codigo)),
      );
    });
    return socket;
  };

  const proxima = (socket: Socket) =>
    new Promise<Mensagem>((resolve) =>
      socket.once('mensagem:nova', (m: Mensagem) => resolve(m)),
    );

  beforeAll(async () => {
    // Sem chave de IA o assistente responde simulado, sem custo nos testes.
    delete process.env.ANTHROPIC_API_KEY;
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    await app.listen(0);
    url = (await app.getUrl()).replace('[::1]', 'localhost');
    empresaId = await criarEmpresa(app, prisma, 'clinica@exemplo.com');
    tokenEmpresa = await entrar(app, 'clinica@exemplo.com');
    anaId = await criarTutor(prisma, 'ana@exemplo.com', 'Ana');
    tokenAna = await entrar(app, 'ana@exemplo.com');
    await criarTutor(prisma, 'bia@exemplo.com', 'Bia');
    tokenBia = await entrar(app, 'bia@exemplo.com');
    await prisma.cliente.create({
      data: {
        codigo: 'C-1',
        nome: 'Ana',
        dataVinculo: new Date(),
        ativo: true,
        empresaId,
        tutorId: anaId,
      },
    });
  });

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await app.close();
    await prisma.$disconnect();
  });

  it('CT-43-01: deve entregar à empresa, em tempo real, a mensagem do tutor cliente', async () => {
    const criada = await como(
      tokenAna,
      http().post('/v1/conversas').send({ tipo: 'EMPRESA', empresaId }),
    ).expect(201);
    conversaId = (criada.body as { id: string }).id;
    expect(criada.body).toMatchObject({ status: 'ABERTA', empresaId });

    const empresa = await conectar(tokenEmpresa);
    const ana = await conectar(tokenAna);
    const chegou = proxima(empresa);
    const ack = (await ana.emitWithAck('mensagem:enviar', {
      conversaId,
      conteudo: '  O Thor pode tomar banho amanhã?  ',
    })) as { ok: boolean; mensagem: Mensagem };
    expect(ack.ok).toBe(true);
    await expect(chegou).resolves.toMatchObject({
      conversaId,
      conteudo: 'O Thor pode tomar banho amanhã?',
      remetenteId: anaId,
    });

    const resposta = proxima(ana);
    await como(
      tokenEmpresa,
      http()
        .post(`/v1/conversas/${conversaId}/mensagens`)
        .send({ conteudo: 'Pode sim, às 9h.' }),
    ).expect(201);
    await expect(resposta).resolves.toMatchObject({
      conteudo: 'Pode sim, às 9h.',
    });
  });

  it('deve listar o histórico e marcar como lidas as mensagens dos outros', async () => {
    const lista = await como(
      tokenAna,
      http().get(`/v1/conversas/${conversaId}/mensagens`),
    ).expect(200);
    expect((lista.body as Mensagem[]).map((m) => m.conteudo)).toEqual([
      'Pode sim, às 9h.',
      'O Thor pode tomar banho amanhã?',
    ]);
    const daEmpresa = await prisma.mensagem.findFirstOrThrow({
      where: { conteudo: 'Pode sim, às 9h.' },
    });
    expect(daEmpresa.lida).toBe(true);
    const conversas = await como(
      tokenEmpresa,
      http().get('/v1/conversas'),
    ).expect(200);
    expect(conversas.body).toEqual([
      expect.objectContaining({ id: conversaId }),
    ]);
  });

  it('deve recusar conversa com empresa sem vínculo e esconder conversa de outro tutor', async () => {
    await como(
      tokenBia,
      http().post('/v1/conversas').send({ tipo: 'EMPRESA', empresaId }),
    ).expect(403);
    await como(
      tokenBia,
      http().get(`/v1/conversas/${conversaId}/mensagens`),
    ).expect(404);
    const bia = await conectar(tokenBia);
    const ack = (await bia.emitWithAck('mensagem:enviar', {
      conversaId,
      conteudo: 'Oi',
    })) as { ok: boolean; codigo: string };
    expect(ack).toMatchObject({ ok: false, codigo: 'NAO_ENCONTRADO' });
  });

  it('CT-43-02: deve bloquear o assistente sem PANTERA e liberar com a assinatura ativa', async () => {
    const bloqueado = await como(
      tokenAna,
      http().post('/v1/conversas').send({ tipo: 'ASSISTENTE_VIRTUAL' }),
    ).expect(402);
    expect(bloqueado.body).toMatchObject({ codigo: 'RN25_ASSINATURA_PANTERA' });

    await prisma.assinatura.create({
      data: {
        plano: 'PANTERA',
        status: 'ATIVA',
        dataInicio: new Date(),
        tutorId: anaId,
      },
    });
    const criada = await como(
      tokenAna,
      http().post('/v1/conversas').send({ tipo: 'ASSISTENTE_VIRTUAL' }),
    ).expect(201);
    assistenteId = (criada.body as { id: string }).id;
  });

  it('deve abrir o assistente com o aviso e responder em tempo real (simulado sem chave)', async () => {
    const historico = await como(
      tokenAna,
      http().get(`/v1/conversas/${assistenteId}/mensagens`),
    ).expect(200);
    expect(historico.body).toEqual([
      expect.objectContaining({
        remetenteId: null,
        conteudo: expect.stringContaining(
          'não substituo o veterinário',
        ) as unknown,
      }),
    ]);

    const ana = await conectar(tokenAna);
    const respostas: Mensagem[] = [];
    const chegou = new Promise<void>((resolve) =>
      ana.on('mensagem:nova', (m: Mensagem) => {
        respostas.push(m);
        if (m.remetenteId === null) resolve();
      }),
    );
    await como(
      tokenAna,
      http()
        .post(`/v1/conversas/${assistenteId}/mensagens`)
        .send({ conteudo: 'Quantos passeios por dia?' }),
    ).expect(201);
    await chegou;
    expect(respostas.map((m) => m.remetenteId)).toEqual([anaId, null]);
    expect(respostas[1].conteudo).toContain('Passeios diários');
  });

  it('deve parar no limite diário de mensagens do assistente', async () => {
    const hoje = new Date();
    await prisma.mensagem.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({
        conversaId: assistenteId,
        conteudo: `Pergunta ${i}`,
        remetenteId: anaId,
        dataHoraEnvio: hoje,
        lida: true,
      })),
    });
    const resposta = await como(
      tokenAna,
      http()
        .post(`/v1/conversas/${assistenteId}/mensagens`)
        .send({ conteudo: 'Mais uma?' }),
    ).expect(429);
    expect(resposta.body).toMatchObject({ codigo: 'ASSISTENTE_LIMITE_DIARIO' });
  });

  it('deve recusar mensagem depois que o tutor encerra a conversa', async () => {
    await como(
      tokenEmpresa,
      http().post(`/v1/conversas/${conversaId}/encerramento`),
    ).expect(403);
    await como(
      tokenAna,
      http().post(`/v1/conversas/${conversaId}/encerramento`),
    ).expect(204);
    const resposta = await como(
      tokenEmpresa,
      http()
        .post(`/v1/conversas/${conversaId}/mensagens`)
        .send({ conteudo: 'Oi?' }),
    ).expect(409);
    expect(resposta.body).toMatchObject({ codigo: 'CONVERSA_ENCERRADA' });
  });

  it('deve recusar a conexão sem access token', async () => {
    await expect(conectar()).rejects.toThrow('NAO_AUTENTICADO');
  });
});
