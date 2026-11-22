import type { ConfigService } from '@nestjs/config';
import { hash } from '@node-rs/argon2';
import type { AuditoriaService } from '../../../compartilhado/auditoria/auditoria.service';
import type { SessoesRevogadas } from '../../../compartilhado/auth/sessoes-revogadas';
import type { Ambiente } from '../../../compartilhado/config/ambiente';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import type { FilaEmailService } from '../../notificacao/aplicacao/fila-email.service';
import { RecuperacaoSenhaService } from './recuperacao-senha.service';

describe('RecuperacaoSenhaService (UC-03, RN05, RN06)', () => {
  const montar = async () => {
    const senhaAtual = await hash('senhaAtual1');
    const prisma = {
      usuario: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u1',
          status: 'ATIVA',
          emailConfirmado: true,
          tutor: { nome: 'Ana' },
          empresaEnterprise: null,
          funcionarioEnterprise: null,
          administrador: null,
        }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ senhaHash: senhaAtual }),
        update: jest.fn().mockResolvedValue({}),
      },
      tokenAcesso: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({
          id: 'tk1',
          tipo: 'RECUPERACAO_SENHA',
          utilizado: false,
          expiraEm: new Date(Date.now() + 60_000),
          usuarioId: 'u1',
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      historicoSenha: { findMany: jest.fn().mockResolvedValue([]) },
      sessao: {
        findMany: jest.fn().mockResolvedValue([{ id: 's1' }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    const fila = { enviar: jest.fn().mockResolvedValue(undefined) };
    const revogadas = { revogar: jest.fn().mockResolvedValue(undefined) };
    const servico = new RecuperacaoSenhaService(
      prisma as unknown as PrismaService,
      fila as unknown as FilaEmailService,
      {
        get: (chave: string) =>
          chave === 'URL_WEB' ? 'http://web.exemplo' : 15,
      } as unknown as ConfigService<Ambiente, true>,
      revogadas as unknown as SessoesRevogadas,
      { registrar: jest.fn() } as unknown as AuditoriaService,
    );
    return { prisma, fila, revogadas, servico };
  };

  const codigo = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return (e as ErroNegocio).codigo;
    }
    return 'SEM_ERRO';
  };

  it('deve mandar o link de 2 horas só para conta ativa', async () => {
    const { prisma, fila, servico } = await montar();
    await servico.solicitar(' Ana@Exemplo.com ');
    expect(prisma.usuario.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'ana@exemplo.com' } }),
    );
    expect(fila.enviar).toHaveBeenCalledWith(
      'RECUPERACAO_SENHA',
      'ana@exemplo.com',
      expect.objectContaining({ nome: 'Ana', validadeMinutos: 120 }),
    );
    prisma.usuario.findUnique.mockResolvedValueOnce(null);
    await servico.solicitar('ninguem@exemplo.com');
    expect(fila.enviar).toHaveBeenCalledTimes(1);
  });

  it('CT-03-01: deve trocar a senha, usar o link e encerrar as sessões', async () => {
    const { prisma, revogadas, servico } = await montar();
    await servico.redefinir('token', 'novaSenha2026');
    expect(prisma.tokenAcesso.update).toHaveBeenCalledWith({
      where: { id: 'tk1' },
      data: { utilizado: true },
    });
    expect(revogadas.revogar).toHaveBeenCalledWith('s1', 900);
  });

  it('CT-03-02 e RN06: deve recusar link vencido e senha repetida ou fraca', async () => {
    const { prisma, servico } = await montar();
    expect(await codigo(servico.redefinir('token', 'senhaAtual1'))).toBe(
      'DADOS_INVALIDOS',
    );
    expect(await codigo(servico.redefinir('token', 'curta'))).toBe(
      'DADOS_INVALIDOS',
    );
    prisma.tokenAcesso.findUnique.mockResolvedValueOnce({
      id: 'tk1',
      tipo: 'RECUPERACAO_SENHA',
      utilizado: false,
      expiraEm: new Date(Date.now() - 1),
      usuarioId: 'u1',
    });
    expect(await codigo(servico.redefinir('token', 'novaSenha2026'))).toBe(
      'LINK_EXPIRADO',
    );
  });
});
