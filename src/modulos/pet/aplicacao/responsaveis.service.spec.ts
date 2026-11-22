import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { ResponsaveisService } from './responsaveis.service';

describe('ResponsaveisService (UC-05, RN09)', () => {
  const ana = { sub: 'ana', tipo: 'TUTOR' } as UsuarioAutenticado;
  const montar = (autorTipo: 'PRINCIPAL' | 'ADICIONAL' = 'PRINCIPAL') => {
    const prisma = {
      responsavelPet: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ tutorId: 'ana', tipo: autorTipo }),
        findMany: jest.fn().mockResolvedValue([
          {
            tutorId: 'ana',
            tipo: 'PRINCIPAL',
            dataVinculo: new Date(),
            tutor: { nome: 'Ana' },
          },
          {
            tutorId: 'caio',
            tipo: 'ADICIONAL',
            dataVinculo: new Date(),
            tutor: { nome: 'Caio' },
          },
        ]),
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      usuario: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'caio',
          status: 'ATIVA',
          tutor: { id: 'caio' },
        }),
      },
    };
    return {
      prisma,
      servico: new ResponsaveisService(prisma as unknown as PrismaService),
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

  it('CT-05-01: deve vincular um tutor ativo e listar marcando o próprio', async () => {
    const { prisma, servico } = montar();
    const lista = await servico.vincular(ana, 'p1', {
      email: 'Caio@Exemplo.com',
      tipo: 'ADICIONAL',
    });
    expect(prisma.responsavelPet.upsert).toHaveBeenCalled();
    expect(lista.find((r) => r.voce)?.tutorId).toBe('ana');
    prisma.responsavelPet.findUnique.mockResolvedValueOnce({ ativo: true });
    expect(
      await codigo(
        servico.vincular(ana, 'p1', { email: 'caio@x.com', tipo: 'ADICIONAL' }),
      ),
    ).toBe('RESPONSAVEL_JA_VINCULADO');
    prisma.usuario.findUnique.mockResolvedValueOnce(null);
    expect(
      await codigo(
        servico.vincular(ana, 'p1', { email: 'x@x.com', tipo: 'ADICIONAL' }),
      ),
    ).toBe('NAO_ENCONTRADO');
  });

  it('CT-05-02: deve manter o principal e limitar o adicional', async () => {
    const { servico } = montar();
    expect(await codigo(servico.remover(ana, 'p1', 'ana'))).toBe(
      'RN09_SEM_PRINCIPAL',
    );
    expect(await codigo(servico.mudarTipo(ana, 'p1', 'ana', 'ADICIONAL'))).toBe(
      'RN09_SEM_PRINCIPAL',
    );
    await servico.mudarTipo(ana, 'p1', 'caio', 'PRINCIPAL');
    await servico.remover(ana, 'p1', 'caio');
    const adicional = montar('ADICIONAL').servico;
    expect(
      await codigo(
        adicional.vincular(ana, 'p1', { email: 'x@x.com', tipo: 'ADICIONAL' }),
      ),
    ).toBe('SEM_PERMISSAO');
    expect(await codigo(adicional.remover(ana, 'p1', 'caio'))).toBe(
      'SEM_PERMISSAO',
    );
  });
});
