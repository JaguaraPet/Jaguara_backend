import type { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import type { Ambiente } from '../../../compartilhado/config/ambiente';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { IntegracoesService } from './integracoes.service';

describe('IntegracoesService (UC-27, UC-30)', () => {
  const admin = { sub: 'adm' } as UsuarioAutenticado;
  const integracao = {
    id: 'i1',
    nome: 'Agenda',
    tipo: 'CALENDARIO' as const,
    endpointUrl: 'https://agenda.exemplo.com',
    parametros: null,
    ativa: true,
    credenciaisCifradas: 'xxx',
  };
  const webhook = {
    id: 'w1',
    url: 'https://parceiro.exemplo.com',
    eventos: ['agendamento.criado'],
    metodoAutenticacao: 'HMAC_SHA256',
    ativo: true,
    integracaoId: null,
  };

  const montar = () => {
    const prisma = {
      integracao: {
        findMany: jest.fn().mockResolvedValue([integracao]),
        findUnique: jest.fn().mockResolvedValue(integracao),
        create: jest.fn().mockResolvedValue(integracao),
        update: jest.fn().mockResolvedValue(integracao),
      },
      webhook: {
        findMany: jest.fn().mockResolvedValue([webhook]),
        findUnique: jest.fn().mockResolvedValue(webhook),
        create: jest.fn().mockResolvedValue(webhook),
        update: jest.fn().mockResolvedValue(webhook),
      },
    };
    const servico = new IntegracoesService(
      prisma as unknown as PrismaService,
      {
        get: () => randomBytes(32).toString('base64'),
      } as unknown as ConfigService<Ambiente, true>,
    );
    return { prisma, servico };
  };

  const codigo = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return (e as ErroNegocio).codigo;
    }
    return 'SEM_ERRO';
  };

  afterEach(() => jest.restoreAllMocks());

  it('CT-27-01: deve cifrar as credenciais e testar o serviço', async () => {
    const { prisma, servico } = montar();
    const criada = await servico.criarIntegracao(admin, {
      nome: 'Agenda',
      tipo: 'CALENDARIO',
      endpointUrl: 'https://agenda.exemplo.com',
      credenciais: 'segredo-do-provedor',
    });
    expect(criada).toMatchObject({ temCredenciais: true });
    const gravado = (
      prisma.integracao.create.mock.calls[0] as [
        { data: { credenciaisCifradas: string } },
      ]
    )[0].data.credenciaisCifradas;
    expect(gravado).not.toContain('segredo');
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockRejectedValueOnce(new Error('timeout'));
    await expect(servico.testarIntegracao('i1')).resolves.toMatchObject({
      ok: true,
    });
    await expect(servico.testarIntegracao('i1')).resolves.toMatchObject({
      ok: false,
    });
    await servico.alterarIntegracao('i1', {
      ativa: false,
      credenciais: 'nova',
    });
    await expect(servico.integracoes()).resolves.toHaveLength(1);
  });

  it('CT-30-01 e CT-30-02: deve gerar o segredo e recusar URL ou eventos inválidos', async () => {
    const { servico } = montar();
    const criado = await servico.criarWebhook(admin, {
      url: 'https://parceiro.exemplo.com',
      eventos: ['agendamento.criado'],
      metodoAutenticacao: 'HMAC_SHA256',
    });
    expect(criado.segredo).toBeDefined();
    const base = {
      url: 'https://parceiro.exemplo.com',
      eventos: ['agendamento.criado'],
      metodoAutenticacao: 'HMAC_SHA256',
    };
    expect(
      await codigo(
        servico.criarWebhook(admin, { ...base, url: 'http://x.com' }),
      ),
    ).toBe('DADOS_INVALIDOS');
    expect(
      await codigo(
        servico.criarWebhook(admin, { ...base, metodoAutenticacao: 'NENHUM' }),
      ),
    ).toBe('DADOS_INVALIDOS');
    expect(
      await codigo(servico.criarWebhook(admin, { ...base, eventos: ['x'] })),
    ).toBe('DADOS_INVALIDOS');
    await servico.alterarWebhook('w1', { ativo: false });
    expect(await codigo(servico.alterarWebhook('w1', { eventos: [] }))).toBe(
      'DADOS_INVALIDOS',
    );
    await expect(servico.webhooks()).resolves.toHaveLength(1);
  });
});
