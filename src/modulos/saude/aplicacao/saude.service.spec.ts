import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import type { PoliticaAcessoPet } from '../../pet/aplicacao/politica-acesso-pet';
import { ordenarAlergias } from '../dominio/alergia';
import { AlergiasService } from './alergias.service';
import { PoliticaSaude } from './politica-saude';

const codigo = async (promessa: Promise<unknown>) => {
  try {
    await promessa;
  } catch (erro) {
    return (erro as ErroNegocio).codigo;
  }
  return 'SEM_ERRO';
};

const tutor: UsuarioAutenticado = {
  sub: 't1',
  sid: 's1',
  tipo: 'TUTOR',
  perfil: 'Tutor',
  empresaId: null,
  permissoes: ['saude:ler', 'saude:editar'],
};
const funcionario: UsuarioAutenticado = {
  ...tutor,
  sub: 'f1',
  tipo: 'FUNCIONARIO',
  perfil: 'Profissional',
  empresaId: 'e1',
  permissoes: ['atendimento:ler', 'atendimento:editar'],
};

describe('PoliticaSaude (RN15, RN30)', () => {
  const montar = (nivel: string, escopos: string[], semConta = false) => {
    const prisma = {
      compartilhamentoPet: {
        findMany: jest.fn().mockResolvedValue([{ escopos }]),
      },
    };
    const politicaPet = {
      nivel: jest.fn().mockResolvedValue(nivel),
      petDeClienteSemConta: jest.fn().mockResolvedValue(semConta),
    };
    return new PoliticaSaude(
      prisma as unknown as PrismaService,
      politicaPet as unknown as PoliticaAcessoPet,
    );
  };

  it('deve esconder o pet de quem não tem vínculo', async () => {
    expect(
      await codigo(
        montar('NENHUM', []).garantir(tutor, 'p1', 'VACINAS', 'ler'),
      ),
    ).toBe('NAO_ENCONTRADO');
  });

  it('deve liberar o tutor e limitar a empresa aos escopos', async () => {
    expect(
      await codigo(
        montar('RESPONSAVEL', []).garantir(tutor, 'p1', 'EXAMES', 'editar'),
      ),
    ).toBe('SEM_ERRO');
    const empresa = montar('EMPRESA', ['VACINAS']);
    expect(
      await codigo(empresa.garantir(funcionario, 'p1', 'VACINAS', 'ler')),
    ).toBe('SEM_ERRO');
    expect(
      await codigo(empresa.garantir(funcionario, 'p1', 'VACINAS', 'editar')),
    ).toBe('SEM_PERMISSAO');
    expect(
      await codigo(
        montar('EMPRESA', [], true).garantir(
          funcionario,
          'p1',
          'EXAMES',
          'editar',
        ),
      ),
    ).toBe('SEM_ERRO');
  });
});

describe('AlergiasService (UC-37)', () => {
  const alergia = {
    id: 'a1',
    petId: 'p1',
    tipo: 'RESTRICAO_MEDICAMENTOSA' as const,
    descricao: 'Dipirona',
    gravidade: 'GRAVE' as const,
    dataIdentificacao: new Date('2026-10-10'),
    observacoes: null,
  };
  const montar = (permitido = true) => {
    const prisma = {
      alergiaRestricao: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { ...alergia, id: 'a2', descricao: 'Frango', gravidade: 'LEVE' },
            alergia,
          ]),
        findUnique: jest.fn().mockResolvedValue(alergia),
        create: jest.fn().mockResolvedValue(alergia),
        update: jest.fn().mockResolvedValue(alergia),
        delete: jest.fn().mockResolvedValue(alergia),
      },
    };
    const politica = {
      garantir: permitido
        ? jest.fn().mockResolvedValue(undefined)
        : jest
            .fn()
            .mockRejectedValue(
              new ErroNegocio(403, 'SEM_PERMISSAO', 'Acesso negado'),
            ),
    };
    const servico = new AlergiasService(
      prisma as unknown as PrismaService,
      politica as unknown as PoliticaSaude,
    );
    return { prisma, servico };
  };

  it('CT-37-01: deve listar as graves primeiro e em destaque', async () => {
    const { servico } = montar();
    const lista = await servico.listar(tutor, 'p1');
    expect(lista.map((a) => [a.descricao, a.destaque])).toEqual([
      ['Dipirona', true],
      ['Frango', false],
    ]);
    expect(
      ordenarAlergias([
        { gravidade: 'MODERADA' as const, descricao: 'B' },
        { gravidade: 'MODERADA' as const, descricao: 'A' },
      ]).map((a) => a.descricao),
    ).toEqual(['A', 'B']);
  });

  it('deve registrar, alterar e recusar data futura', async () => {
    const { prisma, servico } = montar();
    await servico.registrar(tutor, 'p1', {
      tipo: 'ALERGIA',
      descricao: ' Pólen ',
      gravidade: 'LEVE',
    });
    expect(prisma.alergiaRestricao.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ descricao: 'Pólen' }) as unknown,
    });
    await servico.alterar(tutor, 'a1', { observacoes: 'Reação forte' });
    expect(
      await codigo(
        servico.registrar(tutor, 'p1', {
          tipo: 'ALERGIA',
          descricao: 'x',
          gravidade: 'LEVE',
          dataIdentificacao: '2999-01-01',
        }),
      ),
    ).toBe('DADOS_INVALIDOS');
  });

  it('CT-37-02: deve negar a exclusão sem permissão clínica', async () => {
    const negado = montar(false);
    expect(await codigo(negado.servico.excluir(funcionario, 'a1'))).toBe(
      'SEM_PERMISSAO',
    );
    expect(negado.prisma.alergiaRestricao.delete).not.toHaveBeenCalled();
    const { prisma, servico } = montar();
    prisma.alergiaRestricao.findUnique.mockResolvedValueOnce(null);
    expect(await codigo(servico.excluir(tutor, 'x'))).toBe('NAO_ENCONTRADO');
    await servico.excluir(tutor, 'a1');
    expect(prisma.alergiaRestricao.delete).toHaveBeenCalled();
  });
});
