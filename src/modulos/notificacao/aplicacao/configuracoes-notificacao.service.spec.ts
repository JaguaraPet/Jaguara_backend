import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { AgendaNotificacoesService } from './agenda-notificacoes.service';
import { ConfiguracoesNotificacaoService } from './configuracoes-notificacao.service';

describe('Notificações: preferências e agenda (UC-31, RN37)', () => {
  const usuario = { sub: 'u1', tipo: 'TUTOR' } as UsuarioAutenticado;
  const config = {
    id: 'c1',
    usuarioId: 'u1',
    tipoEvento: 'MEDICAMENTO' as const,
    canal: 'EMAIL' as const,
    antecedenciaMinutos: 30,
    ativa: true,
  };

  const montar = () => {
    const prisma = {
      configuracaoNotificacao: {
        findMany: jest.fn().mockResolvedValue([config]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(config),
        update: jest.fn().mockResolvedValue(config),
      },
      notificacao: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'n1',
            titulo: 'Remédio',
            mensagem: 'Dose',
            canal: 'PUSH',
            dataProgramada: new Date('2026-11-21T22:30:00Z'),
            dataEnvio: null,
            status: 'AGENDADA',
          },
        ]),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      responsavelPet: {
        findMany: jest.fn().mockResolvedValue([{ tutorId: 'u1' }]),
      },
    };
    return {
      prisma,
      configuracoes: new ConfiguracoesNotificacaoService(
        prisma as unknown as PrismaService,
      ),
      agenda: new AgendaNotificacoesService(prisma as unknown as PrismaService),
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

  it('deve completar as preferências com o padrão de cada tipo', async () => {
    const { configuracoes } = montar();
    const lista = await configuracoes.listar(usuario);
    expect(lista).toHaveLength(9);
    expect(lista).toContainEqual({
      tipoEvento: 'MEDICAMENTO',
      canal: 'EMAIL',
      antecedenciaMinutos: 30,
      ativa: true,
    });
    expect(lista).toContainEqual(
      expect.objectContaining({ tipoEvento: 'VACINA', canal: 'PUSH' }),
    );
  });

  it('deve criar ou atualizar e recusar SMS e antecedência fora do limite', async () => {
    const { prisma, configuracoes } = montar();
    const dados = {
      canal: 'PUSH' as const,
      antecedenciaMinutos: 30,
      ativa: true,
    };
    await configuracoes.salvar(usuario, 'MEDICAMENTO', dados);
    expect(prisma.configuracaoNotificacao.create).toHaveBeenCalled();
    prisma.configuracaoNotificacao.findFirst.mockResolvedValueOnce(config);
    await configuracoes.salvar(usuario, 'MEDICAMENTO', dados);
    expect(prisma.configuracaoNotificacao.update).toHaveBeenCalled();
    expect(
      await codigo(
        configuracoes.salvar(usuario, 'VACINA', { ...dados, canal: 'SMS' }),
      ),
    ).toBe('DADOS_INVALIDOS');
    expect(
      await codigo(
        configuracoes.salvar(usuario, 'VACINA', {
          ...dados,
          antecedenciaMinutos: 99_999,
        }),
      ),
    ).toBe('DADOS_INVALIDOS');
    await expect(configuracoes.notificacoes(usuario)).resolves.toHaveLength(1);
  });

  it('CT-31-01: deve agendar com o canal e a antecedência do destinatário', async () => {
    const { prisma, agenda } = montar();
    const dose = new Date(Date.now() + 86_400_000);
    await agenda.agendar([
      {
        destinatarioId: 'u1',
        titulo: 'Remédio',
        mensagem: 'Dose',
        dataReferencia: dose,
        tipoEvento: 'MEDICAMENTO',
        origemTipo: 'TRATAMENTO',
        origemId: 'tr1',
      },
    ]);
    expect(prisma.notificacao.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          canal: 'EMAIL',
          dataProgramada: new Date(dose.getTime() - 30 * 60_000),
        }),
      ],
    });
    await expect(agenda.agendar([])).resolves.toBe(0);
    await expect(agenda.responsaveisDoPet('p1')).resolves.toEqual(['u1']);
    await expect(agenda.cancelar('TRATAMENTO', 'tr1')).resolves.toBe(2);
  });
});
