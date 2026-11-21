import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import type { AgendaNotificacoesService } from '../../notificacao/aplicacao/agenda-notificacoes.service';
import { ExamesService } from './exames.service';
import type { PoliticaSaude } from './politica-saude';
import { TratamentosService } from './tratamentos.service';
import { VacinacoesService } from './vacinacoes.service';

const tutor = { sub: 't1', tipo: 'TUTOR' } as UsuarioAutenticado;
const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as ErroNegocio).codigo;
  }
  return 'SEM_ERRO';
};
const dia = (dias: number) =>
  new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);
const registro = { observacoes: null, valido: true, pet: { nome: 'Thor' } };

const montar = () => {
  const prisma = {
    registroClinico: { create: jest.fn() },
    vacinacao: { findMany: jest.fn().mockResolvedValue([]) },
    tratamentoMedicamentoso: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    exame: { findMany: jest.fn().mockResolvedValue([]) },
    documentoPet: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const politica = { garantir: jest.fn().mockResolvedValue(undefined) };
  const agenda = {
    responsaveisDoPet: jest.fn().mockResolvedValue(['t1', 't2']),
    agendar: jest.fn().mockResolvedValue(2),
    cancelar: jest.fn().mockResolvedValue(3),
  };
  const p = prisma as unknown as PrismaService;
  const pol = politica as unknown as PoliticaSaude;
  const ag = agenda as unknown as AgendaNotificacoesService;
  return {
    prisma,
    agenda,
    vacinacoes: new VacinacoesService(p, pol, ag),
    tratamentos: new TratamentosService(p, pol, ag),
    exames: new ExamesService(p, pol),
  };
};

describe('VacinacoesService (UC-12, UC-13)', () => {
  it('CT-13-01: deve registrar e lembrar a próxima dose aos responsáveis', async () => {
    const { prisma, agenda, vacinacoes } = montar();
    prisma.registroClinico.create.mockResolvedValue({
      ...registro,
      id: 'v1',
      vacinacao: {
        id: 'v1',
        nomeVacina: 'V10',
        fabricante: null,
        lote: null,
        dataAplicacao: new Date(dia(-1)),
        dataProximaDose: new Date(dia(30)),
        responsavelAplicacao: 'Dra.',
      },
    });
    await vacinacoes.cadastrar(tutor, 'p1', {
      nomeVacina: 'V10',
      dataAplicacao: dia(-1),
      dataProximaDose: dia(30),
      responsavelAplicacao: 'Dra.',
    });
    expect(agenda.agendar).toHaveBeenCalledWith([
      expect.objectContaining({ destinatarioId: 't1', tipoEvento: 'VACINA' }),
      expect.objectContaining({ destinatarioId: 't2' }),
    ]);
    expect(
      await codigo(
        vacinacoes.cadastrar(tutor, 'p1', {
          nomeVacina: 'V10',
          dataAplicacao: dia(-1),
          responsavelAplicacao: ' ',
        }),
      ),
    ).toBe('DADOS_INVALIDOS');
    await expect(vacinacoes.listar(tutor, 'p1')).resolves.toEqual([]);
  });
});

describe('TratamentosService (UC-14)', () => {
  it('CT-14-01 e CT-14-02: deve agendar as doses e cancelar ao finalizar', async () => {
    const { prisma, agenda, tratamentos } = montar();
    prisma.registroClinico.create.mockResolvedValue({
      ...registro,
      id: 'tr1',
      tratamentoMedicamentoso: {
        id: 'tr1',
        medicamento: 'Amoxicilina',
        dosagem: '1 comprimido',
        viaAdministracao: 'Oral',
        intervaloHoras: 12,
        dataInicio: new Date(dia(1)),
        dataFim: new Date(dia(1)),
        status: 'ATIVO',
      },
    });
    const criado = await tratamentos.cadastrar(tutor, 'p1', {
      medicamento: 'Amoxicilina',
      dosagem: '1 comprimido',
      viaAdministracao: 'Oral',
      intervaloHoras: 12,
      dataInicio: dia(1),
      dataFim: dia(1),
    });
    expect(criado.lembretesAgendados).toBe(2);
    // 8h e 20h, para dois responsáveis.
    expect((agenda.agendar.mock.calls[0] as unknown[][])[0]).toHaveLength(4);
    prisma.tratamentoMedicamentoso.findUnique.mockResolvedValue({
      id: 'tr1',
      status: 'ATIVO',
      registroClinico: { petId: 'p1' },
    });
    await tratamentos.finalizar(tutor, 'tr1');
    expect(agenda.cancelar).toHaveBeenCalledWith('TRATAMENTO', 'tr1');
    prisma.tratamentoMedicamentoso.findUnique.mockResolvedValueOnce(null);
    expect(await codigo(tratamentos.finalizar(tutor, 'x'))).toBe(
      'NAO_ENCONTRADO',
    );
    expect(
      await codigo(
        tratamentos.cadastrar(tutor, 'p1', {
          medicamento: 'x',
          dosagem: 'x',
          viaAdministracao: 'x',
          intervaloHoras: 0,
          dataInicio: dia(1),
        }),
      ),
    ).toBe('DADOS_INVALIDOS');
    await expect(tratamentos.listar(tutor, 'p1')).resolves.toEqual([]);
  });
});

describe('ExamesService (UC-36)', () => {
  it('CT-36-01: deve registrar com laudo do próprio pet e recusar o de outro', async () => {
    const { prisma, exames } = montar();
    prisma.documentoPet.findFirst.mockResolvedValueOnce({
      id: 'doc1',
      arquivoUrl: 's3://x',
    });
    prisma.registroClinico.create.mockResolvedValue({
      ...registro,
      exame: {
        id: 'e1',
        tipoExame: 'Hemograma',
        dataRealizacao: new Date(dia(-2)),
        laboratorio: null,
        resultado: null,
        arquivoResultadoUrl: 's3://x',
      },
    });
    await expect(
      exames.registrar(tutor, 'p1', {
        tipoExame: 'Hemograma',
        dataRealizacao: dia(-2),
        documentoId: 'doc1',
      }),
    ).resolves.toMatchObject({ temArquivo: true, documentoId: 'doc1' });
    expect(
      await codigo(
        exames.registrar(tutor, 'p1', {
          tipoExame: 'Raio X',
          dataRealizacao: dia(-2),
          documentoId: 'outro',
        }),
      ),
    ).toBe('DADOS_INVALIDOS');
    expect(
      await codigo(
        exames.registrar(tutor, 'p1', {
          tipoExame: 'Raio X',
          dataRealizacao: dia(3),
        }),
      ),
    ).toBe('DADOS_INVALIDOS');
    await expect(exames.listar(tutor, 'p1')).resolves.toEqual([]);
  });
});
