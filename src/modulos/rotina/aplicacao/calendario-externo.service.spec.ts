import type { ConfigService } from '@nestjs/config';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import type { Ambiente } from '../../../compartilhado/config/ambiente';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import type { PoliticaAcessoPet } from '../../pet/aplicacao/politica-acesso-pet';
import {
  assinarEstado,
  mesclar,
  verificarEstado,
} from '../dominio/calendario-externo';
import {
  CalendarioGoogle,
  CalendarioSimulado,
} from '../infra/provedor-calendario';
import { CalendarioExternoService } from './calendario-externo.service';

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';
const CHAVE = Buffer.alloc(32, 7).toString('base64');

describe('CalendarioExternoService (UC-09, RN13)', () => {
  const ana = { sub: 'ana', tipo: 'TUTOR' } as UsuarioAutenticado;
  const config = {
    get: (k: string) =>
      ({
        JWT_SECRET: SEGREDO,
        CHAVE_CRIPTOGRAFIA: CHAVE,
        URL_API_PUBLICA: 'https://api.exemplo.com',
      })[k],
  } as unknown as ConfigService<Ambiente, true>;
  const montar = (calendario: object | null = null) => {
    const prisma = {
      calendarioExterno: {
        findFirst: jest.fn().mockResolvedValue(calendario),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      eventoCalendario: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'ev-velho', idExterno: 'saiu' }]),
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn((lista: unknown[]) => Promise.resolve(lista)),
    };
    const politica = {
      nivel: jest.fn().mockResolvedValue('RESPONSAVEL_PRINCIPAL'),
    };
    return {
      prisma,
      servico: new CalendarioExternoService(
        prisma as unknown as PrismaService,
        politica as unknown as PoliticaAcessoPet,
        config,
        new CalendarioSimulado(),
      ),
    };
  };
  const codigo = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: ErroNegocio) => e.codigo,
    );

  it('deve assinar e conferir o estado do OAuth', () => {
    const estado = assinarEstado('ana', SEGREDO, 1000);
    expect(verificarEstado(estado, SEGREDO, 2000)).toBe('ana');
    expect(verificarEstado(estado, 'outro-segredo', 2000)).toBeNull();
    expect(verificarEstado(estado, SEGREDO, 1000 + 11 * 60_000)).toBeNull();
    expect(verificarEstado('lixo', SEGREDO)).toBeNull();
    expect(verificarEstado(`${estado}x`, SEGREDO, 2000)).toBeNull();
  });

  it('deve mesclar criando, atualizando e removendo', () => {
    const inicio = new Date();
    const r = mesclar(
      [
        { id: 'a', idExterno: 'g1' },
        { id: 'b', idExterno: 'g2' },
      ],
      [
        { idExterno: 'g1', titulo: 'Igual', inicio },
        { idExterno: 'g3', titulo: 'Novo', inicio },
        { idExterno: 'g3', titulo: 'Repetido', inicio },
      ],
    );
    expect(r.criar.map((e) => e.titulo)).toEqual(['Novo']);
    expect(r.atualizar.map((a) => a.id)).toEqual(['a']);
    expect(r.remover).toEqual(['b']);
  });

  it('CT-09-01: deve autorizar e importar os compromissos para o pet', async () => {
    const { prisma, servico } = montar();
    const { url } = servico.iniciarAutorizacao(ana);
    const retorno = new URL(url);
    expect(retorno.pathname).toBe('/v1/calendario-externo/google/retorno');
    const resultado = await servico.concluirAutorizacao({
      code: retorno.searchParams.get('code')!,
      state: retorno.searchParams.get('state')!,
    });
    expect(resultado).toBe('conectado');
    const criado = prisma.calendarioExterno.create.mock.calls[0] as [
      { data: { tokenAutorizacao: string; usuarioId: string } },
    ];
    expect(criado[0].data.usuarioId).toBe('ana');
    expect(criado[0].data.tokenAutorizacao).not.toContain('token-simulado');

    const conectado = montar({
      id: 'c1',
      autorizado: true,
      contaExterna: 'agenda.simulada@exemplo.com',
      tokenAutorizacao: criado[0].data.tokenAutorizacao,
    });
    await expect(conectado.servico.sincronizar(ana, 'p1')).resolves.toEqual({
      importados: 2,
      atualizados: 0,
      removidos: 1,
    });
    expect(conectado.prisma.eventoCalendario.create).toHaveBeenCalledTimes(2);
  });

  it('CT-09-02: acesso negado ou estado inválido não guarda nada', async () => {
    const { prisma, servico } = montar();
    const estado = assinarEstado('ana', SEGREDO);
    await expect(
      servico.concluirAutorizacao({ state: estado, error: 'access_denied' }),
    ).resolves.toBe('negado');
    await expect(
      servico.concluirAutorizacao({ code: 'simulado', state: 'falso' }),
    ).resolves.toBe('erro');
    await expect(
      servico.concluirAutorizacao({ code: 'outro', state: estado }),
    ).resolves.toBe('erro');
    expect(prisma.calendarioExterno.create).not.toHaveBeenCalled();
    expect(await codigo(servico.sincronizar(ana, 'p1'))).toBe(
      'RN13_SEM_AUTORIZACAO',
    );
  });

  it('deve montar a autorização do Google e ler os eventos', async () => {
    const respostas = [
      { access_token: 'acesso' },
      {
        items: [
          {
            id: 'g1',
            summary: 'Vacina',
            start: { dateTime: '2026-11-25T13:00:00Z' },
            end: { dateTime: '2026-11-25T14:00:00Z' },
          },
          { id: 'g2', status: 'cancelled', start: { date: '2026-11-26' } },
          { id: 'g3', start: { date: '2026-11-27' } },
        ],
      },
    ];
    const http = jest.fn(() =>
      Promise.resolve(new Response(JSON.stringify(respostas.shift()))),
    );
    const google = new CalendarioGoogle('cliente', 'segredo', http);
    const url = new URL(google.urlAutorizacao('estado', 'https://api/retorno'));
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('scope')).toContain('calendar.readonly');
    const eventos = await google.listarEventos(
      'refresh',
      new Date(),
      new Date(),
    );
    expect(eventos.map((e) => [e.idExterno, e.titulo])).toEqual([
      ['g1', 'Vacina'],
      ['g3', 'Compromisso'],
    ]);
    expect(eventos[1].inicio.toISOString()).toBe('2026-11-27T03:00:00.000Z');
  });
});
