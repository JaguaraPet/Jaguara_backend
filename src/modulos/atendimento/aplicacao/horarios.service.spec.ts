import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { hora, horaValida, minutos, sobrepoe } from '../dominio/horarios';
import { HorariosService } from './horarios.service';

const empresa: UsuarioAutenticado = {
  sub: 'e1',
  sid: 's',
  tipo: 'EMPRESA',
  perfil: 'Empresa',
  empresaId: 'e1',
  permissoes: [],
};
const t = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00Z`);

async function codigo(promessa: Promise<unknown>) {
  try {
    await promessa;
    return 'SEM_ERRO';
  } catch (erro) {
    return (erro as ErroNegocio).codigo;
  }
}

describe('horários (domínio)', () => {
  it('deve converter horas e detectar sobreposição', () => {
    expect(minutos('08:30')).toBe(510);
    expect(hora(510)).toBe('08:30');
    expect(horaValida('24:00')).toBe(false);
    expect(sobrepoe({ inicio: 480, fim: 720 }, { inicio: 660, fim: 780 })).toBe(
      true,
    );
    expect(sobrepoe({ inicio: 480, fim: 720 }, { inicio: 720, fim: 780 })).toBe(
      false,
    );
  });
});

describe('HorariosService', () => {
  let prisma: Record<string, Record<string, jest.Mock>>;
  let servico: HorariosService;
  const horario = {
    id: 'h1',
    diaSemana: 'SEGUNDA',
    horaInicio: t('08:00'),
    horaFim: t('12:00'),
    funcionarioId: 'f1',
    recursoId: null,
  };
  const novo = (extra: Record<string, string>) => ({
    diaSemana: 'SEGUNDA' as const,
    horaInicio: '08:00',
    horaFim: '12:00',
    ...extra,
  });

  beforeEach(() => {
    prisma = {
      horarioAtuacao: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(horario),
        findUnique: jest.fn().mockResolvedValue({
          ...horario,
          funcionario: { empresaId: 'e1' },
          recurso: null,
        }),
        delete: jest.fn(),
      },
      funcionarioEnterprise: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ empresaId: 'e1', ativo: true }),
      },
      recurso: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ empresaId: 'e1', ativo: true }),
      },
    };
    servico = new HorariosService(prisma as unknown as PrismaService);
  });

  it('deve criar e devolver as horas em HH:MM', async () => {
    expect(
      await servico.criar(empresa, 'e1', novo({ funcionarioId: 'f1' })),
    ).toEqual({
      id: 'h1',
      diaSemana: 'SEGUNDA',
      horaInicio: '08:00',
      horaFim: '12:00',
      funcionarioId: 'f1',
    });
  });

  it('deve recusar sobreposição, dono inválido e intervalo invertido', async () => {
    prisma.horarioAtuacao.findMany.mockResolvedValueOnce([horario]);
    expect(
      await codigo(
        servico.criar(
          empresa,
          'e1',
          novo({ horaInicio: '11:00', horaFim: '13:00', funcionarioId: 'f1' }),
        ),
      ),
    ).toBe('HORARIO_SOBREPOSTO');
    expect(
      await codigo(
        servico.criar(
          empresa,
          'e1',
          novo({ horaInicio: '13:00', recursoId: 'r1' }),
        ),
      ),
    ).toBe('DADOS_INVALIDOS');
    expect(await codigo(servico.criar(empresa, 'e1', novo({})))).toBe(
      'DADOS_INVALIDOS',
    );
    prisma.recurso.findUnique.mockResolvedValueOnce({
      empresaId: 'e9',
      ativo: true,
    });
    expect(
      await codigo(servico.criar(empresa, 'e1', novo({ recursoId: 'r9' }))),
    ).toBe('DADOS_INVALIDOS');
    prisma.funcionarioEnterprise.findUnique.mockResolvedValueOnce(null);
    expect(
      await codigo(servico.criar(empresa, 'e1', novo({ funcionarioId: 'f9' }))),
    ).toBe('DADOS_INVALIDOS');
  });

  it('deve listar e remover só na própria empresa', async () => {
    prisma.horarioAtuacao.findMany.mockResolvedValueOnce([horario]);
    expect(await servico.listar(empresa, 'e1')).toHaveLength(1);
    await servico.remover(empresa, 'h1');
    expect(prisma.horarioAtuacao.delete).toHaveBeenCalled();
    prisma.horarioAtuacao.findUnique.mockResolvedValueOnce(null);
    expect(await codigo(servico.remover(empresa, 'h9'))).toBe('NAO_ENCONTRADO');
    expect(await codigo(servico.listar(empresa, 'e2'))).toBe('SEM_PERMISSAO');
  });
});
