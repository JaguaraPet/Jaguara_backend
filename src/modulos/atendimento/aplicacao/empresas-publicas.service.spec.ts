import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { EmpresasPublicasService } from './empresas-publicas.service';

const empresa = {
  id: 'e1',
  nomeFantasia: 'Clínica',
  tipo: 'CLINICA_VETERINARIA' as const,
  enderecoBairro: 'Centro',
  enderecoCidade: 'São Paulo',
  enderecoUf: 'SP',
  servico: [
    { categoria: 'VACINACAO' as const },
    { categoria: 'CONSULTA' as const },
    { categoria: 'CONSULTA' as const },
  ],
};

describe('EmpresasPublicasService', () => {
  let prisma: {
    empresaEnterprise: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let servico: EmpresasPublicasService;

  beforeEach(() => {
    prisma = {
      empresaEnterprise: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([empresa]),
        findFirst: jest.fn().mockResolvedValue(empresa),
      },
      $transaction: jest.fn((operacoes: Promise<unknown>[]) =>
        Promise.all(operacoes),
      ),
    };
    servico = new EmpresasPublicasService(prisma as unknown as PrismaService);
  });

  it('deve paginar e devolver só os dados públicos, com categorias sem repetição', async () => {
    const pagina = await servico.buscar({
      busca: ' clin ',
      tipo: 'CLINICA_VETERINARIA',
      categoria: 'CONSULTA',
      cidade: 'são paulo',
      pagina: 2,
      tamanho: 10,
    });
    expect(pagina).toEqual({
      itens: [
        {
          id: 'e1',
          nomeFantasia: 'Clínica',
          tipo: 'CLINICA_VETERINARIA',
          bairro: 'Centro',
          cidade: 'São Paulo',
          uf: 'SP',
          categorias: ['CONSULTA', 'VACINACAO'],
        },
      ],
      total: 1,
      pagina: 2,
      tamanho: 10,
    });
    const consulta = (
      prisma.empresaEnterprise.findMany.mock.calls[0] as [
        { skip: number; take: number; where: { OR?: unknown } },
      ]
    )[0];
    expect(consulta.skip).toBe(10);
    expect(consulta.take).toBe(10);
    expect(consulta.where.OR).toBeDefined();
  });

  it('deve buscar sem filtros quando nada é informado', async () => {
    await servico.buscar({ pagina: 1, tamanho: 20 });
    const consulta = (
      prisma.empresaEnterprise.findMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ]
    )[0];
    expect(Object.keys(consulta.where).sort()).toEqual([
      'AND',
      'servico',
      'usuario',
    ]);
  });

  it('deve esconder as clínicas de demonstração, menos para a tutora da própria demonstração', async () => {
    await servico.buscar({ pagina: 1, tamanho: 20 }, 't1');
    const consulta = (
      prisma.empresaEnterprise.findMany.mock.calls[0] as [
        { where: { AND: { OR: unknown[] }[] } },
      ]
    )[0];
    expect(consulta.where.AND[0].OR).toEqual([
      { demonstracao: { is: null } },
      { demonstracao: { is: { tutorId: 't1' } } },
    ]);
  });

  it('deve responder 404 quando a empresa não existe ou está inativa', async () => {
    expect((await servico.perfil('e1')).nomeFantasia).toBe('Clínica');
    prisma.empresaEnterprise.findFirst.mockResolvedValue(null);
    await expect(servico.perfil('x')).rejects.toBeInstanceOf(ErroNegocio);
  });
});
