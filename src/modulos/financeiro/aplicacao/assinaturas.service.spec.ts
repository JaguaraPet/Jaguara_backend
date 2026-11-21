import type { ConfigService } from '@nestjs/config';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import type { Ambiente } from '../../../compartilhado/config/ambiente';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { AssinaturasService } from './assinaturas.service';

describe('AssinaturasService (PANTERA)', () => {
  const tutor = { sub: 't1', tipo: 'TUTOR' } as UsuarioAutenticado;
  const pendente = {
    id: 'as1',
    tutorId: 't1',
    plano: 'PANTERA' as const,
    status: 'PENDENTE' as const,
    dataInicio: new Date('2026-11-21'),
    dataFim: null,
  };

  const montar = () => {
    const prisma = {
      assinatura: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(pendente),
        create: jest.fn().mockResolvedValue(pendente),
        update: jest
          .fn()
          .mockResolvedValue({ ...pendente, status: 'CANCELADA' }),
      },
    };
    const servico = new AssinaturasService(
      prisma as unknown as PrismaService,
      { get: () => 14.9 } as unknown as ConfigService<Ambiente, true>,
    );
    return { prisma, servico };
  };

  const codigo = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return (e as ErroNegocio).codigo;
    }
    return 'SEM_ERRO';
  };

  it('deve começar gratuito e criar a assinatura pendente uma vez', async () => {
    const { prisma, servico } = montar();
    await expect(servico.situacao(tutor)).resolves.toMatchObject({
      plano: 'GRATUITO',
      vigente: false,
      precoMensal: 14.9,
    });
    await servico.assinar(tutor);
    expect(prisma.assinatura.create).toHaveBeenCalled();
    prisma.assinatura.findFirst.mockResolvedValueOnce(pendente);
    await expect(servico.assinar(tutor)).resolves.toMatchObject({ id: 'as1' });
    expect(prisma.assinatura.create).toHaveBeenCalledTimes(1);
  });

  it('deve ativar por um mês e emendar na renovação', async () => {
    const { prisma, servico } = montar();
    prisma.assinatura.findFirst.mockResolvedValueOnce({
      dataFim: new Date('2099-01-10'),
    });
    await servico.ativar('as1');
    expect(prisma.assinatura.update).toHaveBeenCalledWith({
      where: { id: 'as1' },
      data: {
        status: 'ATIVA',
        dataInicio: new Date('2099-01-11'),
        dataFim: new Date('2099-02-11'),
      },
    });
    prisma.assinatura.findUnique.mockResolvedValueOnce({
      ...pendente,
      status: 'ATIVA',
    });
    prisma.assinatura.update.mockClear();
    await servico.ativar('as1');
    expect(prisma.assinatura.update).not.toHaveBeenCalled();
  });

  it('deve cancelar só a ativa e conferir a pendente do próprio tutor', async () => {
    const { prisma, servico } = montar();
    expect(await codigo(servico.cancelar(tutor))).toBe(
      'ASSINATURA_INEXISTENTE',
    );
    prisma.assinatura.findFirst.mockResolvedValueOnce({
      ...pendente,
      status: 'ATIVA',
    });
    await expect(servico.cancelar(tutor)).resolves.toMatchObject({
      status: 'CANCELADA',
    });
    expect(await codigo(servico.pendenteDoTutor('outro', 'as1'))).toBe(
      'NAO_ENCONTRADO',
    );
    prisma.assinatura.findUnique.mockResolvedValueOnce({
      ...pendente,
      status: 'ATIVA',
    });
    expect(await codigo(servico.pendenteDoTutor('t1', 'as1'))).toBe(
      'ASSINATURA_JA_PAGA',
    );
  });
});
