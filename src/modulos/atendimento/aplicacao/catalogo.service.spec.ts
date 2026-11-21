import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { CatalogoService } from './catalogo.service';

const empresa: UsuarioAutenticado = {
  sub: 'e1',
  sid: 's',
  tipo: 'EMPRESA',
  perfil: 'Empresa',
  empresaId: 'e1',
  permissoes: [],
};
const tutor: UsuarioAutenticado = {
  ...empresa,
  sub: 't1',
  tipo: 'TUTOR',
  empresaId: null,
};

const servicoBanco = {
  id: 's1',
  empresaId: 'e1',
  nome: 'Banho',
  descricao: 'Banho',
  categoria: 'BANHO_TOSA' as const,
  preco: { toNumber: () => 60 },
  duracaoMinutos: 60,
  ativo: true,
};
const entrada = {
  nome: ' Banho ',
  descricao: 'Banho',
  categoria: 'BANHO_TOSA' as const,
  preco: 70,
  duracaoMinutos: 60,
};

async function codigo(promessa: Promise<unknown>) {
  try {
    await promessa;
    return 'SEM_ERRO';
  } catch (erro) {
    return (erro as ErroNegocio).codigo;
  }
}

describe('CatalogoService', () => {
  let prisma: Record<string, Record<string, jest.Mock>>;
  let servico: CatalogoService;

  beforeEach(() => {
    prisma = {
      empresaEnterprise: {
        findUnique: jest.fn().mockResolvedValue({ id: 'e1' }),
      },
      servico: {
        findMany: jest.fn().mockResolvedValue([servicoBanco]),
        findUnique: jest.fn().mockResolvedValue(servicoBanco),
        create: jest.fn().mockResolvedValue(servicoBanco),
        update: jest.fn().mockResolvedValue({ ...servicoBanco, preco: 70 }),
      },
      recurso: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'r1',
            empresaId: 'e1',
            nome: 'Sala',
            tipo: 'SALA',
            ativo: true,
          },
        ]),
        findUnique: jest.fn().mockResolvedValue({
          id: 'r1',
          empresaId: 'e1',
          nome: 'Sala',
          tipo: 'SALA',
          ativo: true,
        }),
        create: jest.fn().mockResolvedValue({
          id: 'r1',
          empresaId: 'e1',
          nome: 'Sala',
          tipo: 'SALA',
          ativo: true,
        }),
        update: jest.fn().mockResolvedValue({
          id: 'r1',
          empresaId: 'e1',
          nome: 'Sala 2',
          tipo: 'SALA',
          ativo: false,
        }),
      },
    };
    servico = new CatalogoService(prisma as unknown as PrismaService);
  });

  it('deve mostrar ao tutor só serviços ativos e à empresa o catálogo completo', async () => {
    await servico.listarServicos(tutor, 'e1');
    expect(prisma.servico.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { empresaId: 'e1', ativo: true } }),
    );
    const lista = await servico.listarServicos(empresa, 'e1');
    expect(prisma.servico.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { empresaId: 'e1' } }),
    );
    expect(lista[0].preco).toBe(60);
  });

  it('deve responder 404 quando a empresa não existe', async () => {
    prisma.empresaEnterprise.findUnique.mockResolvedValue(null);
    expect(await codigo(servico.listarServicos(tutor, 'x'))).toBe(
      'NAO_ENCONTRADO',
    );
  });

  it('deve criar e alterar serviços só da própria empresa', async () => {
    await servico.criarServico(empresa, 'e1', entrada);
    expect(prisma.servico.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ nome: 'Banho', ativo: true }) as object,
    });
    expect(await codigo(servico.criarServico(empresa, 'e2', entrada))).toBe(
      'SEM_PERMISSAO',
    );
    const alterado = await servico.alterarServico(empresa, 's1', entrada);
    expect(alterado.preco).toBe(70);
    prisma.servico.findUnique.mockResolvedValue({
      ...servicoBanco,
      empresaId: 'e2',
    });
    expect(await codigo(servico.alterarServico(empresa, 's1', entrada))).toBe(
      'SEM_PERMISSAO',
    );
    prisma.servico.findUnique.mockResolvedValue(null);
    expect(await codigo(servico.alterarServico(empresa, 's1', entrada))).toBe(
      'NAO_ENCONTRADO',
    );
  });

  it('deve gerenciar recursos só da própria empresa', async () => {
    expect(await servico.listarRecursos(empresa, 'e1')).toHaveLength(1);
    await servico.criarRecurso(empresa, 'e1', { nome: 'Sala', tipo: 'SALA' });
    const alterado = await servico.alterarRecurso(empresa, 'r1', {
      nome: 'Sala 2',
      tipo: 'SALA',
      ativo: false,
    });
    expect(alterado.ativo).toBe(false);
    expect(await codigo(servico.listarRecursos(empresa, 'e2'))).toBe(
      'SEM_PERMISSAO',
    );
    prisma.recurso.findUnique.mockResolvedValue(null);
    expect(
      await codigo(
        servico.alterarRecurso(empresa, 'r9', { nome: 'X', tipo: 'SALA' }),
      ),
    ).toBe('NAO_ENCONTRADO');
  });
});
