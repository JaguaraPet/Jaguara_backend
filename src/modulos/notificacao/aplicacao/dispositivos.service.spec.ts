import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import {
  EnvioPushExpo,
  URL_EXPO_PUSH,
  tokenExpoValido,
} from '../infra/envio-push-expo';
import { DispositivosService } from './dispositivos.service';

const TOKEN_A = 'ExponentPushToken[aaaa]';
const TOKEN_B = 'ExponentPushToken[bbbb]';

describe('Push pelo Expo (UC-31)', () => {
  const ana = { sub: 'ana' } as UsuarioAutenticado;
  const montarPrisma = (tokens: string[]) => ({
    dispositivoPush: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn().mockResolvedValue(tokens.map((token) => ({ token }))),
    },
  });
  const json = (corpo: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(corpo), { status }));

  it('deve validar o token e registrar o aparelho na conta atual', async () => {
    expect(tokenExpoValido(TOKEN_A)).toBe(true);
    expect(tokenExpoValido('ExpoPushToken[x]')).toBe(true);
    expect(tokenExpoValido('qualquer')).toBe(false);
    const prisma = montarPrisma([]);
    const servico = new DispositivosService(prisma as unknown as PrismaService);
    await servico.registrar(ana, { token: TOKEN_A, plataforma: 'android' });
    expect(prisma.dispositivoPush.upsert).toHaveBeenCalledWith({
      where: { token: TOKEN_A },
      update: { usuarioId: 'ana', plataforma: 'android' },
      create: { token: TOKEN_A, plataforma: 'android', usuarioId: 'ana' },
    });
    const erro = await servico
      .registrar(ana, { token: 'x', plataforma: 'ios' })
      .catch((e: ErroNegocio) => e.codigo);
    expect(erro).toBe('DADOS_INVALIDOS');
    await servico.remover(ana, TOKEN_A);
    expect(prisma.dispositivoPush.deleteMany).toHaveBeenCalledWith({
      where: { token: TOKEN_A, usuarioId: 'ana' },
    });
  });

  it('deve mandar um push por aparelho e tirar o desinstalado', async () => {
    const prisma = montarPrisma([TOKEN_A, TOKEN_B]);
    const http = jest.fn(() =>
      json({
        data: [
          { status: 'ok' },
          { status: 'error', details: { error: 'DeviceNotRegistered' } },
        ],
      }),
    );
    const envio = new EnvioPushExpo(
      prisma as unknown as PrismaService,
      'chave',
      http,
    );
    await envio.enviar('ana', 'Vacina amanhã', 'V10 do Thor');
    const [url, opcoes] = http.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(URL_EXPO_PUSH);
    expect(JSON.parse(opcoes.body as string)).toEqual([
      {
        to: TOKEN_A,
        title: 'Vacina amanhã',
        body: 'V10 do Thor',
        sound: 'default',
      },
      {
        to: TOKEN_B,
        title: 'Vacina amanhã',
        body: 'V10 do Thor',
        sound: 'default',
      },
    ]);
    expect((opcoes.headers as Record<string, string>).Authorization).toBe(
      'Bearer chave',
    );
    expect(prisma.dispositivoPush.deleteMany).toHaveBeenCalledWith({
      where: { token: { in: [TOKEN_B] } },
    });
  });

  it('deve lançar erro quando o Expo recusa, para o disparo tentar de novo', async () => {
    const prisma = montarPrisma([TOKEN_A]);
    const recusa = new EnvioPushExpo(
      prisma as unknown as PrismaService,
      undefined,
      () => json({ data: [{ status: 'error', message: 'Limite' }] }),
    );
    await expect(recusa.enviar('ana', 't', 'm')).rejects.toThrow('Limite');
    const fora = new EnvioPushExpo(
      prisma as unknown as PrismaService,
      undefined,
      () => json({}, 503),
    );
    await expect(fora.enviar('ana', 't', 'm')).rejects.toThrow('503');
    const semAparelho = new EnvioPushExpo(
      montarPrisma([]) as unknown as PrismaService,
      undefined,
      jest.fn(),
    );
    await expect(semAparelho.enviar('ana', 't', 'm')).resolves.toBeUndefined();
  });
});
