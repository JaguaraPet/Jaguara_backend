import type { AvaliacoesService } from './avaliacoes.service';
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
  enderecoCep: '01310100',
  latitude: null as number | null,
  longitude: null as number | null,
  servico: [
    { categoria: 'VACINACAO' as const, preco: { toNumber: () => 90 } },
    { categoria: 'CONSULTA' as const, preco: { toNumber: () => 150 } },
    { categoria: 'CONSULTA' as const, preco: { toNumber: () => 120 } },
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
    servico = new EmpresasPublicasService(
      prisma as unknown as PrismaService,
      {
        resumoDe: jest.fn((ids: string[]) =>
          Promise.resolve(
            new Map(ids.map((id) => [id, { media: 4.5, total: 2 }])),
          ),
        ),
      } as unknown as AvaliacoesService,
      { doCep: jest.fn().mockResolvedValue(null) },
    );
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
          formasPagamento: undefined,
          notaMedia: 4.5,
          totalAvaliacoes: 2,
          precoAPartirDe: 90,
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

  it('deve ordenar por distância a partir da localização e pôr no fim quem não tem coordenadas', async () => {
    prisma.empresaEnterprise.findMany.mockResolvedValue([
      {
        ...empresa,
        id: 'longe',
        nomeFantasia: 'Longe',
        latitude: -23.7,
        longitude: -46.8,
      },
      { ...empresa, id: 'sem', nomeFantasia: 'Sem mapa' },
      {
        ...empresa,
        id: 'perto',
        nomeFantasia: 'Perto',
        latitude: -23.561,
        longitude: -46.656,
      },
    ]);
    const pagina = await servico.buscar({
      latitude: -23.56,
      longitude: -46.655,
      pagina: 1,
      tamanho: 10,
    });
    expect(pagina.itens.map((i) => [i.id, i.distanciaKm])).toEqual([
      ['perto', 0.2],
      ['longe', 21.5],
      ['sem', undefined],
    ]);
  });
});
