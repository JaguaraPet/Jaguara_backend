import type { ConfigService } from '@nestjs/config';
import { hash } from '@node-rs/argon2';
import type { AuditoriaService } from '../../../compartilhado/auditoria/auditoria.service';
import type { SessoesRevogadas } from '../../../compartilhado/auth/sessoes-revogadas';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import type { Ambiente } from '../../../compartilhado/config/ambiente';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { PrivacidadeService } from './privacidade.service';

describe('PrivacidadeService (UC-46)', () => {
  const tutor = { sub: 't1', tipo: 'TUTOR' } as UsuarioAutenticado;
  const termos = [
    {
      id: 'uso',
      tipo: 'TERMOS_USO_APP',
      versao: '1.0',
      titulo: 'Termos de uso',
      conteudo: 'x',
      dataVigencia: new Date('2026-11-01'),
      obrigatorio: true,
    },
    {
      id: 'mkt',
      tipo: 'COMUNICACAO_MARKETING',
      versao: '1.0',
      titulo: 'Novidades',
      conteudo: 'x',
      dataVigencia: new Date('2026-11-01'),
      obrigatorio: false,
    },
  ];

  const montar = async () => {
    const senhaHash = await hash('senhaForte1');
    const tx = {
      responsavelPet: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      pet: { update: jest.fn().mockResolvedValue({}) },
      compartilhamentoPet: { updateMany: jest.fn().mockResolvedValue({}) },
      tutor: { update: jest.fn().mockResolvedValue({}) },
      usuario: { update: jest.fn().mockResolvedValue({}) },
      notificacao: { updateMany: jest.fn().mockResolvedValue({}) },
      sessao: { deleteMany: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      termoUso: { findMany: jest.fn().mockResolvedValue(termos) },
      consentimento: {
        findMany: jest.fn().mockResolvedValue([
          {
            termoId: 'mkt',
            aceito: true,
            dataAceite: new Date('2026-11-02'),
            dataRevogacao: null,
            meioColeta: 'ACEITE_NO_APP',
            termo: { tipo: 'COMUNICACAO_MARKETING', versao: '1.0' },
          },
        ]),
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({}),
      },
      solicitacaoPrivacidade: {
        create: jest.fn().mockResolvedValue({ id: 's1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      usuario: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          senhaHash,
          email: 'ana@exemplo.com',
          telefone: null,
          dataCadastro: new Date('2026-11-01'),
          tutor: { nome: 'Ana', dataNascimento: null },
        }),
      },
      responsavelPet: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'v1', petId: 'p1', tipo: 'PRINCIPAL' }]),
      },
      pet: { findMany: jest.fn().mockResolvedValue([]) },
      registroClinico: { findMany: jest.fn().mockResolvedValue([]) },
      despesa: { findMany: jest.fn().mockResolvedValue([]) },
      eventoCalendario: { findMany: jest.fn().mockResolvedValue([]) },
      registroAlimentacao: { findMany: jest.fn().mockResolvedValue([]) },
      sessao: { findMany: jest.fn().mockResolvedValue([{ id: 's1' }]) },
      $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
    const revogadas = { revogar: jest.fn().mockResolvedValue(undefined) };
    const servico = new PrivacidadeService(
      prisma as unknown as PrismaService,
      auditoria as unknown as AuditoriaService,
      revogadas as unknown as SessoesRevogadas,
      { get: () => 15 } as unknown as ConfigService<Ambiente, true>,
    );
    return { prisma, tx, auditoria, revogadas, servico };
  };

  const codigo = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return (e as ErroNegocio).codigo;
    }
    return 'SEM_ERRO';
  };

  it('CT-46-03: deve mostrar o obrigatório sem aceite como pendente', async () => {
    const { servico } = await montar();
    const lista = await servico.consentimentos(tutor);
    expect(lista).toEqual([
      expect.objectContaining({
        termoId: 'uso',
        obrigatorio: true,
        aceito: false,
      }),
      expect.objectContaining({ termoId: 'mkt', aceito: true }),
    ]);
  });

  it('CT-46-01 e CT-46-02: deve revogar o opcional e recusar o obrigatório', async () => {
    const { prisma, auditoria, servico } = await montar();
    await servico.atualizar(
      tutor,
      [{ termoId: 'mkt', aceito: false }],
      '1.1.1.1',
    );
    expect(prisma.consentimento.updateMany).toHaveBeenCalled();
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ acao: 'CONSENTIMENTO_REVOGADO' }),
    );
    expect(
      await codigo(
        servico.atualizar(tutor, [{ termoId: 'uso', aceito: false }], 'ip'),
      ),
    ).toBe('RN25_TERMO_OBRIGATORIO');
    expect(
      await codigo(
        servico.atualizar(tutor, [{ termoId: 'x', aceito: true }], 'ip'),
      ),
    ).toBe('DADOS_INVALIDOS');
    prisma.consentimento.findMany.mockResolvedValueOnce([]);
    await servico.atualizar(tutor, [{ termoId: 'uso', aceito: true }], 'ip');
    expect(prisma.consentimento.create).toHaveBeenCalled();
  });

  it('deve exportar e excluir a conta só com a senha certa', async () => {
    const { tx, revogadas, servico } = await montar();
    await expect(servico.exportar(tutor)).resolves.toMatchObject({
      conta: { email: 'ana@exemplo.com', nome: 'Ana' },
    });
    await expect(
      servico.solicitar(tutor, 'EXPORTACAO_DADOS', undefined, 'ip'),
    ).resolves.toMatchObject({ status: 'CONCLUIDA' });
    expect(
      await codigo(servico.solicitar(tutor, 'EXCLUSAO_DADOS', 'errada1', 'ip')),
    ).toBe('DADOS_INVALIDOS');
    await servico.solicitar(tutor, 'EXCLUSAO_DADOS', 'senhaForte1', 'ip');
    expect(tx.pet.update).toHaveBeenCalled();
    expect(tx.usuario.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'INATIVA' }) as unknown,
      }),
    );
    expect(revogadas.revogar).toHaveBeenCalledWith('s1', 900);
    await expect(
      servico.solicitar(tutor, 'CORRECAO_DADOS', undefined, 'ip'),
    ).resolves.toMatchObject({ status: 'ABERTA' });
  });
});
