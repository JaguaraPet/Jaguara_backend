import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { LinhaDoTempoService } from './linha-do-tempo.service';
import type { PoliticaSaude } from './politica-saude';

describe('LinhaDoTempoService (UC-35)', () => {
  it('CT-35-01: deve juntar os registros em ordem cronológica', async () => {
    const prisma = {
      vacinacao: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'v1',
            nomeVacina: 'V10',
            dataAplicacao: new Date('2026-03-01'),
          },
        ]),
      },
      exame: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'e1',
            tipoExame: 'Hemograma',
            dataRealizacao: new Date('2026-01-10'),
          },
        ]),
      },
      tratamentoMedicamentoso: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 't1',
            medicamento: 'Vermífugo',
            dataInicio: new Date('2026-02-01'),
          },
        ]),
      },
      eventoCalendario: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'ev1',
            titulo: 'Consulta',
            dataHoraInicio: new Date('2026-12-01T13:00:00Z'),
          },
        ]),
      },
      atendimento: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'a1',
            finalizadoEm: new Date('2026-05-05T15:00:00Z'),
            dataHoraInicio: new Date('2026-05-05T14:00:00Z'),
            agendamento: {
              servico: { nome: 'Banho', empresa: { nomeFantasia: 'Pet Shop' } },
            },
          },
          {
            id: 'a2',
            finalizadoEm: null,
            dataHoraInicio: new Date('2026-06-01T10:00:00Z'),
            agendamento: null,
          },
        ]),
      },
    };
    const politica = { garantir: jest.fn().mockResolvedValue(undefined) };
    const servico = new LinhaDoTempoService(
      prisma as unknown as PrismaService,
      politica as unknown as PoliticaSaude,
    );
    const itens = await servico.consultar(
      { sub: 't1' } as UsuarioAutenticado,
      'p1',
    );
    expect(itens.map((i) => i.titulo)).toEqual([
      'Exame: Hemograma',
      'Início do tratamento: Vermífugo',
      'Vacina V10',
      'Banho em Pet Shop',
      'Atendimento',
      'Consulta',
    ]);
    expect(politica.garantir).toHaveBeenCalledWith(
      expect.anything(),
      'p1',
      'LINHA_DO_TEMPO',
      'ler',
    );
  });
});
