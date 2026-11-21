import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { PERMISSOES } from '../dominio/catalogo-permissoes';
import { CatalogoAcessoService } from './catalogo-acesso.service';

describe('CatalogoAcessoService', () => {
  function criar() {
    const prisma = {
      permissao: {
        upsert: jest.fn(({ where }: { where: { codigo: string } }) =>
          Promise.resolve({ id: `id-${where.codigo}` }),
        ),
        findMany: jest.fn(() =>
          Promise.resolve(
            Object.keys(PERMISSOES).map((codigo) => ({
              id: `id-${codigo}`,
              codigo,
            })),
          ),
        ),
      },
      perfilAcesso: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(({ data }: { data: { nome: string } }) =>
          Promise.resolve({ id: `perfil-${data.nome}` }),
        ),
      },
      perfilPermissao: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    return {
      prisma,
      servico: new CatalogoAcessoService(prisma as unknown as PrismaService),
    };
  }

  it('deve criar todas as permissões e os três perfis globais quando o banco está vazio', async () => {
    const { prisma, servico } = criar();
    await servico.onApplicationBootstrap();
    expect(prisma.permissao.upsert).toHaveBeenCalledTimes(
      Object.keys(PERMISSOES).length,
    );
    expect(
      prisma.perfilAcesso.create.mock.calls.map((c) => c[0].data.nome),
    ).toEqual(['Tutor', 'Administrador', 'Empresa']);
    expect(prisma.perfilPermissao.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  it('deve reaproveitar o perfil global quando ele já existe', async () => {
    const { prisma, servico } = criar();
    prisma.perfilAcesso.findFirst.mockResolvedValue({ id: 'existente' });
    await servico.sincronizar();
    expect(prisma.perfilAcesso.create).not.toHaveBeenCalled();
  });

  it('deve criar os perfis Proprietário, Atendente e Profissional para uma empresa nova (RN20)', async () => {
    const { prisma, servico } = criar();
    await servico.criarPerfisDaEmpresa('e1');
    const nomes = prisma.perfilAcesso.create.mock.calls.map(
      (c) => (c[0] as { data: { nome: string; empresaId: string } }).data,
    );
    expect(nomes.map((d) => d.nome)).toEqual([
      'Proprietário',
      'Atendente',
      'Profissional',
    ]);
    expect(nomes.every((d) => d.empresaId === 'e1')).toBe(true);
  });
});
