import type { ConfigService } from '@nestjs/config';
import type { SessoesRevogadas } from '../../../compartilhado/auth/sessoes-revogadas';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import type { Ambiente } from '../../../compartilhado/config/ambiente';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { mesmoNome, problemaNoPerfil } from '../dominio/perfis';
import { PerfisService } from './perfis.service';

describe('PerfisService (UC-16, RN20)', () => {
  const empresa = {
    sub: 'e1',
    tipo: 'EMPRESA',
    empresaId: 'e1',
    permissoes: ['perfil:editar'],
  } as UsuarioAutenticado;
  const perfilGerente = {
    id: 'p9',
    nome: 'Gerente',
    descricao: null,
    empresaId: 'e1',
    perfilPermissao: [{ permissao: { codigo: 'agenda:ler' } }],
  };
  const montar = (emUso = 0) => {
    const prisma = {
      perfilAcesso: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'p1', nome: 'Atendente' }]),
        findUnique: jest.fn().mockResolvedValue(perfilGerente),
        findUniqueOrThrow: jest.fn().mockResolvedValue(perfilGerente),
        create: jest.fn().mockResolvedValue({ id: 'p9' }),
        update: jest.fn(),
        delete: jest.fn(),
      },
      perfilPermissao: { deleteMany: jest.fn() },
      permissao: {
        findMany: jest.fn().mockResolvedValue([{ id: 'x1' }, { id: 'x2' }]),
      },
      usuario: { count: jest.fn().mockResolvedValue(emUso) },
      sessao: {
        findMany: jest.fn().mockResolvedValue([{ id: 's1' }, { id: 's2' }]),
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const revogadas = { revogar: jest.fn() };
    const config = { get: jest.fn().mockReturnValue(15) };
    return {
      prisma,
      revogadas,
      servico: new PerfisService(
        prisma as unknown as PrismaService,
        revogadas as unknown as SessoesRevogadas,
        config as unknown as ConfigService<Ambiente, true>,
      ),
    };
  };
  const codigo = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: ErroNegocio) => e.codigo,
    );

  it('deve validar nome e permissões do perfil', () => {
    expect(
      problemaNoPerfil({ nome: 'Gerente', permissoes: ['agenda:ler'] }),
    ).toBeNull();
    expect(
      problemaNoPerfil({ nome: 'G', permissoes: ['agenda:ler'] })?.campo,
    ).toBe('nome');
    expect(problemaNoPerfil({ nome: 'Gerente', permissoes: [] })?.campo).toBe(
      'permissoes',
    );
    expect(
      problemaNoPerfil({ nome: 'Gerente', permissoes: ['admin:usuarios'] })
        ?.mensagem,
    ).toMatch(/admin:usuarios/);
    expect(mesmoNome(' Proprietário ', 'proprietario')).toBe(true);
  });

  it('deve listar as permissões da empresa e criar o perfil', async () => {
    const { prisma, servico } = montar();
    const lista = servico.permissoesDisponiveis(empresa, 'e1');
    expect(lista.map((p) => p.codigo)).toContain('agenda:editar');
    expect(lista.map((p) => p.codigo)).not.toContain('admin:usuarios');
    const criado = await servico.criar(empresa, 'e1', {
      nome: 'Gerente',
      permissoes: ['agenda:ler', 'relatorio:ler'],
    });
    expect(criado).toEqual({
      id: 'p9',
      nome: 'Gerente',
      descricao: undefined,
      permissoes: ['agenda:ler'],
    });
    expect(prisma.perfilAcesso.create.mock.calls[0]).toMatchObject([
      { data: { escopo: 'EMPRESA', empresaId: 'e1' } },
    ]);
    expect(
      await codigo(
        servico.criar(empresa, 'e1', {
          nome: 'atendente',
          permissoes: ['agenda:ler'],
        }),
      ),
    ).toBe('PERFIL_DUPLICADO');
  });

  it('CT-16-01: deve alterar o perfil e encerrar as sessões de quem o usa', async () => {
    const { prisma, revogadas, servico } = montar();
    await servico.alterar(empresa, 'p9', {
      nome: 'Gerente',
      permissoes: ['agenda:ler', 'agenda:editar'],
    });
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.sessao.deleteMany).toHaveBeenCalled();
    expect(revogadas.revogar).toHaveBeenCalledWith('s1', 900);
  });

  it('deve proteger o Proprietário, outra empresa e perfil em uso', async () => {
    const { prisma, servico } = montar(2);
    expect(await codigo(servico.excluir(empresa, 'p9'))).toBe('PERFIL_EM_USO');
    prisma.perfilAcesso.findUnique.mockResolvedValueOnce({
      ...perfilGerente,
      nome: 'Proprietário',
    });
    expect(await codigo(servico.excluir(empresa, 'p9'))).toBe(
      'PERFIL_PROTEGIDO',
    );
    prisma.perfilAcesso.findUnique.mockResolvedValueOnce({
      ...perfilGerente,
      empresaId: 'e2',
    });
    expect(await codigo(servico.excluir(empresa, 'p9'))).toBe('SEM_PERMISSAO');
    prisma.perfilAcesso.findUnique.mockResolvedValueOnce(null);
    expect(await codigo(servico.excluir(empresa, 'p9'))).toBe('NAO_ENCONTRADO');
  });

  it('deve excluir perfil sem ninguém', async () => {
    const { prisma, servico } = montar(0);
    await servico.excluir(empresa, 'p9');
    expect(prisma.perfilAcesso.delete).toHaveBeenCalledWith({
      where: { id: 'p9' },
    });
  });
});
