import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { motivosDoVinculo, secoesLiberadas } from '../dominio/perfil-empresa';
import { PetsVinculadosService } from './pets-vinculados.service';

describe('PetsVinculadosService (UC-20, UC-22)', () => {
  const funcionario = {
    sub: 'f1',
    tipo: 'FUNCIONARIO',
    empresaId: 'e1',
    permissoes: ['atendimento:ler'],
  } as UsuarioAutenticado;
  const pet = (extra: object) => ({
    id: 'p1',
    nome: 'Thor',
    sexo: 'MACHO',
    status: 'ATIVO',
    dataNascimento: null,
    raca: { nome: 'SRD', especie: { nome: 'Cachorro' } },
    compartilhamentoPet: [],
    agendamento: [],
    clientePet: [],
    ...extra,
  });
  const montar = () => {
    const prisma = {
      pet: {
        findMany: jest.fn().mockResolvedValue([
          pet({
            compartilhamentoPet: [{ escopos: ['VACINAS', 'ALERGIAS'] }],
          }),
        ]),
        findUnique: jest
          .fn()
          .mockResolvedValue(
            pet({ clientePet: [{ cliente: { tutorId: null } }] }),
          ),
      },
      vacinacao: { findMany: jest.fn().mockResolvedValue([]) },
      exame: { findMany: jest.fn().mockResolvedValue([]) },
      tratamentoMedicamentoso: { findMany: jest.fn().mockResolvedValue([]) },
      alergiaRestricao: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return {
      prisma,
      servico: new PetsVinculadosService(prisma as unknown as PrismaService),
    };
  };
  const codigo = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return (e as ErroNegocio).codigo;
    }
    return 'SEM_ERRO';
  };

  it('deve calcular motivos e seções do vínculo', () => {
    expect(
      secoesLiberadas({ escopos: ['VACINAS'], clienteSemConta: false }),
    ).toEqual(['vacinas']);
    expect(
      secoesLiberadas({ escopos: [], clienteSemConta: true }),
    ).toHaveLength(4);
    expect(
      motivosDoVinculo({ compartilhado: true, agendado: true, cliente: false }),
    ).toEqual(['COMPARTILHAMENTO', 'AGENDAMENTO']);
  });

  it('CT-20-01 e CT-22-01: deve listar e abrir o perfil com as seções liberadas', async () => {
    const { prisma, servico } = montar();
    await expect(servico.listar(funcionario, 'e1')).resolves.toEqual([
      expect.objectContaining({ secoes: ['vacinas', 'alergias'] }),
    ]);
    const perfil = await servico.perfil(funcionario, 'e1', 'p1');
    expect(perfil.secoes).toHaveLength(4);
    expect(prisma.exame.findMany).toHaveBeenCalled();
  });

  it('CT-22-02: deve negar pet sem vínculo, outra empresa e perfil sem permissão', async () => {
    const { prisma, servico } = montar();
    prisma.pet.findUnique.mockResolvedValueOnce(pet({}));
    expect(await codigo(servico.perfil(funcionario, 'e1', 'p1'))).toBe(
      'SEM_PERMISSAO',
    );
    expect(await codigo(servico.listar(funcionario, 'e2'))).toBe(
      'SEM_PERMISSAO',
    );
    expect(
      await codigo(servico.listar({ ...funcionario, permissoes: [] }, 'e1')),
    ).toBe('SEM_PERMISSAO');
  });
});
