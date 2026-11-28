import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { AgendaNotificacoesService } from '../../notificacao/aplicacao/agenda-notificacoes.service';
import { LembretesAgendamentoService } from './lembretes-agendamento.service';

describe('LembretesAgendamentoService', () => {
  const agendamento = {
    id: 'a1',
    petId: 'p1',
    status: 'AGENDADO',
    dataHoraInicio: new Date('2026-11-25T13:30:00Z'), // 10h30 em Brasília
    pet: { nome: 'Bento' },
    servico: {
      nome: 'Vacina V10',
      categoria: 'VACINACAO',
      empresa: { nomeFantasia: 'Clínica Vida Animal' },
    },
  };
  let prisma: { agendamento: { findUnique: jest.Mock } };
  let notificacoes: {
    responsaveisDoPet: jest.Mock;
    agendar: jest.Mock;
    cancelar: jest.Mock;
  };
  let servico: LembretesAgendamentoService;

  beforeEach(() => {
    prisma = {
      agendamento: { findUnique: jest.fn().mockResolvedValue(agendamento) },
    };
    notificacoes = {
      responsaveisDoPet: jest.fn().mockResolvedValue(['t1', 't2']),
      agendar: jest.fn().mockResolvedValue(4),
      cancelar: jest.fn().mockResolvedValue(0),
    };
    servico = new LembretesAgendamentoService(
      prisma as unknown as PrismaService,
      notificacoes as unknown as AgendaNotificacoesService,
    );
  });

  it('deve programar um lembrete um dia antes e outro duas horas antes para cada responsável', async () => {
    await servico.programar('a1');
    type Lembrete = {
      destinatarioId: string;
      antecedenciaMinutos: number;
      titulo: string;
      mensagem: string;
      tipoEvento: string;
    };
    const chamadas = notificacoes.agendar.mock.calls as Lembrete[][][];
    const lista = chamadas[0][0];
    expect(
      lista.map((n) => `${n.destinatarioId}:${n.antecedenciaMinutos}`),
    ).toEqual(['t1:1440', 't1:120', 't2:1440', 't2:120']);
    expect(lista[0].titulo).toBe('Amanhã: Vacina V10 do Bento');
    expect(lista[0].mensagem).toContain('Às 10:30 na Clínica Vida Animal');
    expect(lista[0].tipoEvento).toBe('VACINA');
  });

  it('não deve programar lembrete de agendamento cancelado', async () => {
    prisma.agendamento.findUnique.mockResolvedValue({
      ...agendamento,
      status: 'CANCELADO',
    });
    expect(await servico.programar('a1')).toBe(0);
    expect(notificacoes.agendar).not.toHaveBeenCalled();
  });

  it('deve cancelar os lembretes antigos antes de reprogramar', async () => {
    await servico.reprogramar('a1');
    expect(notificacoes.cancelar).toHaveBeenCalledWith('AGENDAMENTO', 'a1');
    expect(notificacoes.agendar).toHaveBeenCalled();
  });
});
