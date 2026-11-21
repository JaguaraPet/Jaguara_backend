import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import type { AgendaNotificacoesService } from '../../notificacao/aplicacao/agenda-notificacoes.service';
import type { PoliticaAcessoPet } from '../../pet/aplicacao/politica-acesso-pet';
import { EventosService } from './eventos.service';

describe('EventosService (UC-10, RN14)', () => {
  const tutor = { sub: 't1', tipo: 'TUTOR' } as UsuarioAutenticado;
  const inicio = new Date(Date.now() + 2 * 86_400_000);
  const evento = {
    id: 'ev1',
    titulo: 'Consulta',
    descricao: null,
    tipo: 'CONSULTA' as const,
    dataHoraInicio: inicio,
    dataHoraFim: null,
    local: 'Clínica',
    origem: 'MANUAL' as const,
    pet: { nome: 'Thor' },
  };

  const montar = () => {
    const prisma = {
      eventoCalendario: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(evento),
        findUnique: jest.fn().mockResolvedValue({ ...evento, petId: 'p1' }),
        delete: jest.fn().mockResolvedValue(evento),
      },
      agendamento: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'ag1',
            dataHoraInicio: new Date(inicio.getTime() + 3_600_000 * 5),
            dataHoraFim: new Date(inicio.getTime() + 3_600_000 * 6),
            servico: {
              nome: 'Banho',
              categoria: 'BANHO_TOSA',
              empresa: { nomeFantasia: 'Pet Shop' },
            },
          },
        ]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const agenda = {
      responsaveisDoPet: jest.fn().mockResolvedValue(['t1']),
      agendar: jest.fn().mockResolvedValue(1),
      cancelar: jest.fn().mockResolvedValue(1),
    };
    const servico = new EventosService(
      prisma as unknown as PrismaService,
      {
        nivel: jest.fn().mockResolvedValue('RESPONSAVEL_PRINCIPAL'),
      } as unknown as PoliticaAcessoPet,
      agenda as unknown as AgendaNotificacoesService,
    );
    return { prisma, agenda, servico };
  };

  const codigo = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return (e as ErroNegocio).codigo;
    }
    return 'SEM_ERRO';
  };

  it('CT-10-01: deve criar o evento e agendar o lembrete para os responsáveis', async () => {
    const { agenda, servico } = montar();
    await servico.criar(tutor, 'p1', {
      titulo: 'Consulta',
      tipo: 'CONSULTA',
      dataHoraInicio: inicio.toISOString(),
    });
    expect(agenda.agendar).toHaveBeenCalledWith([
      expect.objectContaining({
        tipoEvento: 'CONSULTA',
        dataReferencia: inicio,
      }),
    ]);
  });

  it('CT-10-02: deve recusar conflito com outro evento ou agendamento', async () => {
    const { prisma, servico } = montar();
    prisma.eventoCalendario.findMany.mockResolvedValueOnce([
      { dataHoraInicio: inicio, dataHoraFim: null },
    ]);
    const dados = {
      titulo: 'Passeio',
      tipo: 'COMPROMISSO' as const,
      dataHoraInicio: new Date(inicio.getTime() + 30 * 60_000).toISOString(),
    };
    expect(await codigo(servico.criar(tutor, 'p1', dados))).toBe(
      'RN14_CONFLITO_PET',
    );
    prisma.agendamento.count.mockResolvedValueOnce(1);
    expect(await codigo(servico.criar(tutor, 'p1', dados))).toBe(
      'RN14_CONFLITO_PET',
    );
    expect(
      await codigo(
        servico.criar(tutor, 'p1', {
          ...dados,
          dataHoraFim: new Date(inicio.getTime() - 1).toISOString(),
        }),
      ),
    ).toBe('DADOS_INVALIDOS');
  });

  it('deve listar eventos e agendamentos e excluir só evento manual', async () => {
    const { prisma, agenda, servico } = montar();
    prisma.eventoCalendario.findMany.mockResolvedValueOnce([evento]);
    const lista = await servico.listar(tutor, 'p1', {});
    expect(lista.map((e) => e.origem)).toEqual(['MANUAL', 'AGENDAMENTO']);
    await servico.excluir(tutor, 'ev1');
    expect(agenda.cancelar).toHaveBeenCalledWith('EVENTO', 'ev1');
    prisma.eventoCalendario.findUnique.mockResolvedValueOnce({
      ...evento,
      petId: 'p1',
      origem: 'AGENDAMENTO',
    });
    expect(await codigo(servico.excluir(tutor, 'ev1'))).toBe('EVENTO_EXTERNO');
  });
});
