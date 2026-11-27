import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { hojeEmBrasilia, ResumoDoDiaService } from './resumo-do-dia.service';

const empresa: UsuarioAutenticado = {
  sub: 'e1',
  sid: 's1',
  tipo: 'EMPRESA',
  perfil: 'Empresa',
  empresaId: 'e1',
  permissoes: [],
};

const dose = (
  pet: string,
  vacina: string,
  aplicacao: string,
  proxima: string | null,
) => ({
  nomeVacina: vacina,
  dataAplicacao: new Date(`${aplicacao}T00:00:00Z`),
  dataProximaDose: proxima ? new Date(`${proxima}T00:00:00Z`) : null,
  registroClinico: {
    pet: {
      id: pet,
      nome: pet,
      clientePet: [{ cliente: { nome: 'Ana', telefone: '11' } }],
    },
  },
});

describe('ResumoDoDiaService', () => {
  // 21/11/2026, 23h em Brasília: em UTC já é dia 22
  const agora = new Date('2026-11-22T02:00:00Z');
  let prisma: Record<string, Record<string, jest.Mock>>;
  let servico: ResumoDoDiaService;

  beforeEach(() => {
    prisma = {
      agendamento: { findMany: jest.fn().mockResolvedValue([]) },
      solicitacaoServico: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      pagamento: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'p1',
            valor: '120.00',
            dataHora: agora,
            pagador: { nome: 'Ana' },
            agendamento: {
              pet: { nome: 'Thor' },
              servico: { nome: 'Vacina V10' },
            },
          },
          {
            id: 'p2',
            valor: '80.50',
            dataHora: agora,
            pagador: { nome: 'Bruno' },
            agendamento: null,
          },
        ]),
        aggregate: jest.fn().mockResolvedValue({ _sum: { valor: '300.00' } }),
      },
      atendimento: { count: jest.fn().mockResolvedValue(4) },
      vacinacao: {
        // Ordenadas da aplicação mais nova para a mais antiga, como na consulta real
        findMany: jest
          .fn()
          .mockResolvedValue([
            dose('Thor', 'Vacina V10', '2026-11-01', '2027-11-01'),
            dose('Thor', 'Vacina V10', '2025-11-01', '2026-11-01'),
            dose('Mel', 'Antirrábica', '2025-11-15', '2026-11-15'),
            dose('Nina', 'Vacina V10', '2026-01-10', '2026-12-10'),
            dose('Fred', 'Vacina V10', '2025-06-01', '2026-06-01'),
          ]),
      },
    };
    servico = new ResumoDoDiaService(prisma as unknown as PrismaService);
  });

  it('deve usar a data de Brasília, e não a de UTC', () => {
    expect(hojeEmBrasilia(agora)).toBe('2026-11-21');
  });

  it('deve listar só vacinas atrasadas há até 60 dias ou vencendo em 30, sem as já renovadas', async () => {
    const resumo = await servico.resumo(empresa, 'e1', agora);
    expect(resumo.vacinas).toEqual([
      expect.objectContaining({
        petNome: 'Mel',
        proximaDose: '2026-11-15',
        atrasada: true,
      }),
      expect.objectContaining({
        petNome: 'Nina',
        proximaDose: '2026-12-10',
        atrasada: false,
      }),
    ]);
  });

  it('deve somar as cobranças em aberto e o recebido da semana', async () => {
    const resumo = await servico.resumo(empresa, 'e1', agora);
    expect(resumo.cobrancas).toEqual(
      expect.objectContaining({ total: 2, valor: '200.50' }),
    );
    expect(resumo.cobrancas?.itens[1]).toEqual(
      expect.objectContaining({ descricao: 'Cobrança', petNome: null }),
    );
    expect(resumo.semana).toEqual({ faturamento: '300.00', atendimentos: 4 });
  });

  it('deve esconder o financeiro de funcionário sem permissão', async () => {
    const atendente = {
      ...empresa,
      sub: 'f1',
      tipo: 'FUNCIONARIO' as const,
      permissoes: ['agenda:ler'],
    };
    const resumo = await servico.resumo(atendente, 'e1', agora);
    expect(resumo.cobrancas).toBeNull();
    expect(resumo.semana.faturamento).toBeNull();
    expect(prisma.pagamento.findMany).not.toHaveBeenCalled();
  });

  it('deve negar o resumo de outra empresa', async () => {
    await expect(servico.resumo(empresa, 'e2', agora)).rejects.toBeInstanceOf(
      ErroNegocio,
    );
  });
});
