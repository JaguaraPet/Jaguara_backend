import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import type { PoliticaAcessoPet } from '../../pet/aplicacao/politica-acesso-pet';
import type { ConfigService } from '@nestjs/config';
import type { Ambiente } from '../../../compartilhado/config/ambiente';
import { AssistenteSimulado } from '../infra/assistente-simulado';
import { AssistenteService } from './assistente.service';
import { CanalTempoReal } from './canal-tempo-real';
import { ConversasService, EVENTO_MENSAGEM_NOVA } from './conversas.service';

describe('ConversasService (UC-43)', () => {
  const tutor: UsuarioAutenticado = {
    sub: 't1',
    sid: 's1',
    tipo: 'TUTOR',
    perfil: 'Tutor',
    empresaId: null,
    permissoes: ['chat:usar'],
  };
  const atendente: UsuarioAutenticado = {
    ...tutor,
    sub: 'f1',
    tipo: 'FUNCIONARIO',
    perfil: 'Atendente',
    empresaId: 'e1',
  };
  const conversa = {
    id: 'c1',
    tipo: 'EMPRESA' as const,
    tutorId: 't1',
    empresaId: 'e1',
    petId: null,
    status: 'ABERTA' as const,
  };

  const montar = () => {
    const prisma = {
      conversa: {
        findMany: jest.fn().mockResolvedValue([
          {
            ...conversa,
            tutor: { nome: 'Ana' },
            empresa: { nomeFantasia: 'Patas' },
            pet: null,
            mensagem: [
              { conteudo: 'Oi', dataHoraEnvio: new Date(), remetenteId: 't1' },
            ],
            _count: { mensagem: 2 },
          },
        ]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(conversa),
        create: jest.fn().mockResolvedValue(conversa),
        update: jest.fn().mockResolvedValue(conversa),
      },
      mensagem: {
        create: jest.fn().mockResolvedValue({
          id: 'm1',
          conversaId: 'c1',
          conteudo: 'Oi',
          dataHoraEnvio: new Date('2026-11-20T12:00:00Z'),
          remetenteId: 't1',
          lida: false,
        }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        count: jest.fn().mockResolvedValue(0),
      },
      pet: { findUnique: jest.fn().mockResolvedValue(null) },
      cliente: { count: jest.fn().mockResolvedValue(0) },
      agendamento: { count: jest.fn().mockResolvedValue(0) },
      assinatura: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    const politica = { nivel: jest.fn().mockResolvedValue('NENHUM') };
    const canal = new CanalTempoReal();
    const emitir = jest.spyOn(canal, 'emitir');
    const assistente = new AssistenteService(
      prisma as unknown as PrismaService,
      { get: () => 2 } as unknown as ConfigService<Ambiente, true>,
      new AssistenteSimulado(),
    );
    const servico = new ConversasService(
      prisma as unknown as PrismaService,
      politica as unknown as PoliticaAcessoPet,
      canal,
      assistente,
    );
    return { prisma, politica, emitir, servico };
  };

  const codigo = async (promessa: Promise<unknown>) => {
    try {
      await promessa;
    } catch (erro) {
      return (erro as ErroNegocio).codigo;
    }
    return 'SEM_ERRO';
  };

  it('deve aceitar como vínculo o agendamento com a empresa', async () => {
    const { prisma, servico } = montar();
    expect(
      await codigo(
        servico.iniciar(tutor, { tipo: 'EMPRESA', empresaId: 'e1' }),
      ),
    ).toBe('SEM_PERMISSAO');
    prisma.agendamento.count.mockResolvedValue(1);
    await expect(
      servico.iniciar(tutor, { tipo: 'EMPRESA', empresaId: 'e1' }),
    ).resolves.toMatchObject({ id: 'c1', empresaId: 'e1' });
  });

  it('deve reaproveitar a conversa aberta em vez de criar outra', async () => {
    const { prisma, servico } = montar();
    prisma.cliente.count.mockResolvedValue(1);
    prisma.conversa.findFirst.mockResolvedValue(conversa);
    await servico.iniciar(tutor, { tipo: 'EMPRESA', empresaId: 'e1' });
    expect(prisma.conversa.create).not.toHaveBeenCalled();
  });

  it('deve exigir PANTERA vigente e pet do próprio tutor', async () => {
    const { prisma, politica, servico } = montar();
    expect(
      await codigo(servico.iniciar(tutor, { tipo: 'ASSISTENTE_VIRTUAL' })),
    ).toBe('RN25_ASSINATURA_PANTERA');
    prisma.assinatura.findMany.mockResolvedValue([
      { plano: 'PANTERA', status: 'ATIVA', dataFim: null },
    ]);
    expect(
      await codigo(
        servico.iniciar(tutor, { tipo: 'ASSISTENTE_VIRTUAL', petId: 'p1' }),
      ),
    ).toBe('SEM_PERMISSAO');
    politica.nivel.mockResolvedValue('RESPONSAVEL_PRINCIPAL');
    expect(
      await codigo(
        servico.iniciar(tutor, { tipo: 'ASSISTENTE_VIRTUAL', petId: 'p1' }),
      ),
    ).toBe('SEM_ERRO');
    expect(
      await codigo(
        servico.iniciar(atendente, { tipo: 'EMPRESA', empresaId: 'e1' }),
      ),
    ).toBe('SEM_PERMISSAO');
    expect(await codigo(servico.iniciar(tutor, { tipo: 'EMPRESA' }))).toBe(
      'DADOS_INVALIDOS',
    );
  });

  it('deve gravar a mensagem e avisar as salas do tutor e da empresa', async () => {
    const { emitir, servico } = montar();
    const mensagem = await servico.enviar(atendente, 'c1', '  Oi  ');
    expect(mensagem).toMatchObject({ id: 'm1', remetenteId: 't1' });
    expect(emitir).toHaveBeenCalledWith(
      ['usuario:t1', 'empresa:e1'],
      EVENTO_MENSAGEM_NOVA,
      mensagem,
    );
    expect(await codigo(servico.enviar(atendente, 'c1', ' '))).toBe(
      'DADOS_INVALIDOS',
    );
  });

  it('deve esconder a conversa de quem não participa e recusar envio após o encerramento', async () => {
    const { prisma, servico } = montar();
    expect(
      await codigo(servico.mensagens({ ...atendente, empresaId: 'e2' }, 'c1')),
    ).toBe('NAO_ENCONTRADO');
    prisma.conversa.findUnique.mockResolvedValue({
      ...conversa,
      status: 'ENCERRADA',
    });
    expect(await codigo(servico.enviar(tutor, 'c1', 'Oi'))).toBe(
      'CONVERSA_ENCERRADA',
    );
    await servico.encerrar(tutor, 'c1');
    expect(prisma.conversa.update).not.toHaveBeenCalled();
  });

  it('deve listar por tutor ou por empresa e negar o administrador', async () => {
    const { prisma, servico } = montar();
    const [resumo] = await servico.listar(tutor);
    expect(resumo).toMatchObject({
      tutor: 'Ana',
      empresa: 'Patas',
      naoLidas: 2,
      ultimaMensagem: { conteudo: 'Oi', minha: true },
    });
    expect(prisma.conversa.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tutorId: 't1' } }),
    );
    await servico.listar(atendente);
    expect(prisma.conversa.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { empresaId: 'e1', tipo: 'EMPRESA' } }),
    );
    expect(
      await codigo(
        servico.listar({ ...tutor, tipo: 'ADMINISTRADOR', empresaId: null }),
      ),
    ).toBe('SEM_PERMISSAO');
  });

  it('deve abrir o assistente com o aviso e responder depois da mensagem do tutor', async () => {
    const { prisma, emitir, servico } = montar();
    const doAssistente = {
      ...conversa,
      tipo: 'ASSISTENTE_VIRTUAL' as const,
      empresaId: null,
    };
    prisma.assinatura.findMany.mockResolvedValue([
      { plano: 'PANTERA', status: 'ATIVA', dataFim: null },
    ]);
    prisma.conversa.create.mockResolvedValue(doAssistente);
    await servico.iniciar(tutor, { tipo: 'ASSISTENTE_VIRTUAL' });
    expect(prisma.mensagem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ remetenteId: null }) as unknown,
      }),
    );

    prisma.conversa.findUnique.mockResolvedValue(doAssistente);
    prisma.mensagem.findMany.mockResolvedValue([
      {
        conteudo: 'Que petisco posso dar?',
        remetenteId: 't1',
        dataHoraEnvio: new Date(),
      },
    ]);
    await servico.enviar(tutor, 'c1', 'Que petisco posso dar?');
    await servico.onApplicationShutdown();
    expect(prisma.mensagem.create).toHaveBeenCalledTimes(3);
    expect(emitir).toHaveBeenCalledTimes(3);

    prisma.mensagem.count.mockResolvedValue(2);
    expect(await codigo(servico.enviar(tutor, 'c1', 'Mais uma'))).toBe(
      'ASSISTENTE_LIMITE_DIARIO',
    );
  });
});
