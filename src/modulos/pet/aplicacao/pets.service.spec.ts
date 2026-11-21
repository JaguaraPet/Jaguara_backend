import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { idadeEmAnos, podeExcluirPet } from '../dominio/pet';
import { PetsService } from './pets.service';
import { PoliticaAcessoPet } from './politica-acesso-pet';

const tutor: UsuarioAutenticado = {
  sub: 't1',
  sid: 's',
  tipo: 'TUTOR',
  perfil: 'Tutor',
  empresaId: null,
  permissoes: [],
};
const empresa: UsuarioAutenticado = {
  ...tutor,
  sub: 'e1',
  tipo: 'EMPRESA',
  empresaId: 'e1',
  permissoes: ['cliente:editar'],
};

const petBanco = {
  id: 'p1',
  nome: 'Thor',
  racaId: 'r1',
  dataNascimento: new Date('2021-03-10T00:00:00Z'),
  sexo: 'MACHO' as const,
  pesoKg: { toNumber: () => 29.5 },
  cor: null,
  microchip: null,
  castrado: true,
  status: 'ATIVO' as const,
  fotoUrl: null,
  raca: { nome: 'Labrador', especie: { nome: 'Cachorro' } },
};
const entrada = {
  nome: 'Thor',
  racaId: 'r1',
  sexo: 'MACHO' as const,
  castrado: true,
  microchip: '123',
};

async function codigo(promessa: Promise<unknown>) {
  try {
    await promessa;
    return 'SEM_ERRO';
  } catch (erro) {
    return (erro as ErroNegocio).codigo;
  }
}

describe('regras do pet', () => {
  it('deve calcular a idade em anos completos', () => {
    const nascimento = new Date('2021-03-10T00:00:00Z');
    expect(idadeEmAnos(nascimento, new Date('2026-03-09T00:00:00Z'))).toBe(4);
    expect(idadeEmAnos(nascimento, new Date('2026-03-10T00:00:00Z'))).toBe(5);
    expect(idadeEmAnos(null, new Date())).toBeUndefined();
  });

  it('deve permitir excluir só sem histórico (RN08)', () => {
    expect(
      podeExcluirPet({ registrosClinicos: 0, despesas: 0, agendamentos: 0 }),
    ).toBe(true);
    expect(
      podeExcluirPet({ registrosClinicos: 1, despesas: 0, agendamentos: 0 }),
    ).toBe(false);
  });
});

describe('PetsService', () => {
  let prisma: Record<string, Record<string, jest.Mock>> & {
    $transaction: jest.Mock;
  };
  let politica: { nivel: jest.Mock; petDeClienteSemConta: jest.Mock };
  let servico: PetsService;

  beforeEach(() => {
    prisma = {
      especie: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'e',
            nome: 'Cachorro',
            raca: [{ id: 'r1', nome: 'Labrador' }],
          },
        ]),
      },
      raca: { findUnique: jest.fn().mockResolvedValue({ id: 'r1' }) },
      pet: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([petBanco]),
        findUnique: jest.fn().mockResolvedValue(petBanco),
        create: jest.fn().mockResolvedValue(petBanco),
        update: jest.fn().mockResolvedValue(petBanco),
        delete: jest.fn(),
      },
      registroClinico: { count: jest.fn().mockResolvedValue(0) },
      despesa: { count: jest.fn().mockResolvedValue(0) },
      agendamento: { count: jest.fn().mockResolvedValue(0) },
      responsavelPet: { deleteMany: jest.fn() },
      clientePet: { deleteMany: jest.fn() },
    } as unknown as typeof prisma;
    prisma.$transaction = jest.fn((ops: Promise<unknown>[]) =>
      Promise.all(ops),
    );
    politica = {
      nivel: jest.fn().mockResolvedValue('RESPONSAVEL_PRINCIPAL'),
      petDeClienteSemConta: jest.fn().mockResolvedValue(false),
    };
    servico = new PetsService(
      prisma as unknown as PrismaService,
      politica as unknown as PoliticaAcessoPet,
    );
  });

  it('deve listar espécies com as raças', async () => {
    expect(await servico.listarEspecies()).toEqual([
      { id: 'e', nome: 'Cachorro', racas: [{ id: 'r1', nome: 'Labrador' }] },
    ]);
  });

  it('deve listar e paginar os pets do tutor', async () => {
    const pagina = await servico.listar(tutor, {
      status: 'ATIVO',
      pagina: 2,
      tamanho: 5,
    });
    expect(pagina).toMatchObject({
      total: 1,
      pagina: 2,
      itens: [{ nome: 'Thor', especie: 'Cachorro', pesoKg: 29.5 }],
    });
  });

  it('deve cadastrar com responsável principal e recusar raça inválida e microchip repetido', async () => {
    prisma.pet.findUnique.mockResolvedValueOnce(null);
    await servico.cadastrar(tutor, entrada);
    const dados = (
      prisma.pet.create.mock.calls[0] as [
        { data: { responsavelPet: { create: { tipo: string } } } },
      ]
    )[0].data;
    expect(dados.responsavelPet.create.tipo).toBe('PRINCIPAL');
    prisma.raca.findUnique.mockResolvedValueOnce(null);
    expect(await codigo(servico.cadastrar(tutor, entrada))).toBe(
      'DADOS_INVALIDOS',
    );
    expect(await codigo(servico.cadastrar(tutor, entrada))).toBe(
      'MICROCHIP_EM_USO',
    );
  });

  it('deve negar a consulta sem acesso e responder 404 para pet inexistente', async () => {
    politica.nivel.mockResolvedValue('NENHUM');
    expect(await codigo(servico.consultar(tutor, 'p1'))).toBe('SEM_PERMISSAO');
    prisma.pet.findUnique.mockResolvedValue(null);
    expect(await codigo(servico.consultar(tutor, 'p9'))).toBe('NAO_ENCONTRADO');
  });

  it('deve deixar a empresa editar só pet de cliente sem conta (ADR-010, RN30)', async () => {
    politica.nivel.mockResolvedValue('EMPRESA');
    expect(
      await codigo(
        servico.editar(empresa, 'p1', { ...entrada, microchip: undefined }),
      ),
    ).toBe('SEM_PERMISSAO');
    politica.petDeClienteSemConta.mockResolvedValue(true);
    expect(
      await codigo(
        servico.editar(empresa, 'p1', { ...entrada, microchip: undefined }),
      ),
    ).toBe('SEM_ERRO');
  });

  it('deve arquivar e excluir só pelo responsável principal, sem histórico (RN08)', async () => {
    await servico.arquivar(tutor, 'p1');
    expect(prisma.pet.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { status: 'ARQUIVADO' },
    });
    await servico.excluir(tutor, 'p1');
    expect(prisma.pet.delete).toHaveBeenCalled();
    prisma.agendamento.count.mockResolvedValue(1);
    expect(await codigo(servico.excluir(tutor, 'p1'))).toBe(
      'RN08_PET_COM_HISTORICO',
    );
    politica.nivel.mockResolvedValue('RESPONSAVEL');
    expect(await codigo(servico.arquivar(tutor, 'p1'))).toBe('SEM_PERMISSAO');
  });
});

describe('PoliticaAcessoPet', () => {
  function criar(contagens: {
    compartilhado?: number;
    agendado?: number;
    cliente?: number;
    responsavel?: string | null;
  }) {
    const prisma = {
      responsavelPet: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            contagens.responsavel ? { tipo: contagens.responsavel } : null,
          ),
      },
      compartilhamentoPet: {
        count: jest.fn().mockResolvedValue(contagens.compartilhado ?? 0),
      },
      agendamento: {
        count: jest.fn().mockResolvedValue(contagens.agendado ?? 0),
      },
      clientePet: {
        count: jest.fn().mockResolvedValue(contagens.cliente ?? 0),
      },
    };
    return new PoliticaAcessoPet(prisma as unknown as PrismaService);
  }

  it('deve classificar o tutor pelo vínculo de responsável', async () => {
    expect(await criar({ responsavel: 'PRINCIPAL' }).nivel(tutor, 'p1')).toBe(
      'RESPONSAVEL_PRINCIPAL',
    );
    expect(await criar({ responsavel: 'ADICIONAL' }).nivel(tutor, 'p1')).toBe(
      'RESPONSAVEL',
    );
    expect(await criar({ responsavel: null }).nivel(tutor, 'p1')).toBe(
      'NENHUM',
    );
  });

  it('deve liberar a empresa com compartilhamento, agendamento ou cliente (RN24, RN26)', async () => {
    expect(await criar({ compartilhado: 1 }).nivel(empresa, 'p1')).toBe(
      'EMPRESA',
    );
    expect(await criar({ agendado: 1 }).nivel(empresa, 'p1')).toBe('EMPRESA');
    expect(await criar({}).nivel(empresa, 'p1')).toBe('NENHUM');
    expect(await criar({ cliente: 1 }).petDeClienteSemConta('e1', 'p1')).toBe(
      true,
    );
  });
});
