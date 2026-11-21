import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash } from '@node-rs/argon2';
import { SessoesRevogadas } from '../../../compartilhado/auth/sessoes-revogadas';
import { AuditoriaService } from '../../../compartilhado/auditoria/auditoria.service';
import { Ambiente } from '../../../compartilhado/config/ambiente';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { AutenticacaoService } from './autenticacao.service';

const SENHA = 'Senha@Forte123';

function criarUsuario(extra: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    email: 'ana@exemplo.com',
    senhaHash: '',
    status: 'ATIVA',
    emailConfirmado: true,
    tentativasLoginFalhas: 0,
    bloqueadoAte: null,
    ...extra,
  };
}

const usuarioComAcesso = {
  id: 'u1',
  perfil: {
    nome: 'Tutor',
    perfilPermissao: [{ permissao: { codigo: 'pet:ler' } }],
  },
  tutor: { id: 'u1' },
  empresaEnterprise: null,
  funcionarioEnterprise: null,
  administrador: null,
};

describe('AutenticacaoService', () => {
  let prisma: {
    usuario: Record<string, jest.Mock>;
    sessao: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let jwt: { signAsync: jest.Mock };
  let revogadas: { revogar: jest.Mock };
  let servico: AutenticacaoService;
  let senhaHash: string;

  beforeAll(async () => {
    senhaHash = await hash(SENHA);
  });

  beforeEach(() => {
    prisma = {
      usuario: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        findUniqueOrThrow: jest.fn().mockResolvedValue(usuarioComAcesso),
      },
      sessao: {
        create: jest.fn().mockResolvedValue({ id: 's1' }),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn((operacoes: Promise<unknown>[]) =>
        Promise.all(operacoes),
      ),
    };
    jwt = { signAsync: jest.fn().mockResolvedValue('access-token') };
    revogadas = { revogar: jest.fn().mockResolvedValue(undefined) };
    const config = {
      get: jest.fn(
        (chave: string) =>
          ({ SESSAO_INATIVIDADE_HORAS: 4, JWT_EXPIRACAO_MINUTOS: 15 })[chave],
      ),
    };
    servico = new AutenticacaoService(
      prisma as unknown as PrismaService,
      jwt as unknown as JwtService,
      revogadas as unknown as SessoesRevogadas,
      config as unknown as ConfigService<Ambiente, true>,
      {
        registrar: jest.fn().mockResolvedValue(undefined),
      } as unknown as AuditoriaService,
    );
  });

  async function codigoDoErro(promessa: Promise<unknown>): Promise<string> {
    try {
      await promessa;
    } catch (erro) {
      return (erro as ErroNegocio).codigo;
    }
    return 'SEM_ERRO';
  }

  describe('login', () => {
    it('deve criar a sessão e zerar as falhas quando a senha está certa', async () => {
      prisma.usuario.findUnique.mockResolvedValue(
        criarUsuario({ senhaHash, tentativasLoginFalhas: 2 }),
      );

      const tokens = await servico.login(' Ana@Exemplo.com ', SENHA, 'jest');

      expect(prisma.usuario.findUnique).toHaveBeenCalledWith({
        where: { email: 'ana@exemplo.com' },
      });
      expect(prisma.usuario.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { tentativasLoginFalhas: 0, bloqueadoAte: null },
      });
      expect(tokens.accessToken).toBe('access-token');
      expect(tokens.refreshToken.length).toBeGreaterThan(40);
      const sessao = (
        prisma.sessao.create.mock.calls[0] as [{ data: { token: string } }]
      )[0];
      expect(sessao.data.token).toHaveLength(64);
      expect(sessao.data.token).not.toBe(tokens.refreshToken);
      expect(jwt.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'u1',
          sid: 's1',
          tipo: 'TUTOR',
          permissoes: ['pet:ler'],
        }),
      );
    });

    it('deve recusar sem revelar o motivo quando o e-mail não existe', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);
      expect(await codigoDoErro(servico.login('x@exemplo.com', SENHA))).toBe(
        'CREDENCIAIS_INVALIDAS',
      );
    });

    it('deve somar uma falha quando a senha está errada', async () => {
      prisma.usuario.findUnique.mockResolvedValue(criarUsuario({ senhaHash }));
      expect(
        await codigoDoErro(servico.login('ana@exemplo.com', 'errada')),
      ).toBe('CREDENCIAIS_INVALIDAS');
      expect(prisma.usuario.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { tentativasLoginFalhas: 1, bloqueadoAte: null },
      });
    });

    it('deve bloquear quando erra pela quinta vez (RN03)', async () => {
      prisma.usuario.findUnique.mockResolvedValue(
        criarUsuario({ senhaHash, tentativasLoginFalhas: 4 }),
      );
      expect(
        await codigoDoErro(servico.login('ana@exemplo.com', 'errada')),
      ).toBe('RN03_CONTA_BLOQUEADA');
    });

    it('deve recusar mesmo com a senha certa quando a conta está bloqueada', async () => {
      prisma.usuario.findUnique.mockResolvedValue(
        criarUsuario({
          senhaHash,
          bloqueadoAte: new Date(Date.now() + 60_000),
        }),
      );
      expect(await codigoDoErro(servico.login('ana@exemplo.com', SENHA))).toBe(
        'RN03_CONTA_BLOQUEADA',
      );
      expect(prisma.sessao.create).not.toHaveBeenCalled();
    });

    it('deve recusar quando o e-mail não foi confirmado (RN02)', async () => {
      prisma.usuario.findUnique.mockResolvedValue(
        criarUsuario({
          senhaHash,
          emailConfirmado: false,
          status: 'PENDENTE_CONFIRMACAO',
        }),
      );
      expect(await codigoDoErro(servico.login('ana@exemplo.com', SENHA))).toBe(
        'RN02_EMAIL_NAO_CONFIRMADO',
      );
    });

    it('deve recusar quando a conta está suspensa', async () => {
      prisma.usuario.findUnique.mockResolvedValue(
        criarUsuario({ senhaHash, status: 'SUSPENSA' }),
      );
      expect(await codigoDoErro(servico.login('ana@exemplo.com', SENHA))).toBe(
        'CONTA_INDISPONIVEL',
      );
    });
  });

  describe('renovar', () => {
    it('deve trocar o refresh token e atualizar a atividade quando a sessão está ativa', async () => {
      prisma.sessao.findUnique.mockResolvedValue({
        id: 's1',
        usuarioId: 'u1',
        ultimaAtividade: new Date(),
        usuario: { status: 'ATIVA' },
      });
      const tokens = await servico.renovar('refresh-antigo');
      const atualizacao = (
        prisma.sessao.update.mock.calls[0] as [{ data: { token: string } }]
      )[0];
      expect(atualizacao.data.token).toHaveLength(64);
      expect(tokens.refreshToken).not.toBe('refresh-antigo');
    });

    it('deve recusar quando o refresh token não existe', async () => {
      prisma.sessao.findUnique.mockResolvedValue(null);
      expect(await codigoDoErro(servico.renovar('desconhecido'))).toBe(
        'NAO_AUTENTICADO',
      );
    });

    it('deve encerrar a sessão quando passou de 4 horas sem atividade (RN04)', async () => {
      prisma.sessao.findUnique.mockResolvedValue({
        id: 's1',
        usuarioId: 'u1',
        ultimaAtividade: new Date(Date.now() - 5 * 3_600_000),
        usuario: { status: 'ATIVA' },
      });
      expect(await codigoDoErro(servico.renovar('r'))).toBe(
        'RN04_SESSAO_EXPIRADA',
      );
      expect(prisma.sessao.delete).toHaveBeenCalledWith({
        where: { id: 's1' },
      });
    });

    it('deve encerrar a sessão quando a conta deixou de estar ativa', async () => {
      prisma.sessao.findUnique.mockResolvedValue({
        id: 's1',
        usuarioId: 'u1',
        ultimaAtividade: new Date(),
        usuario: { status: 'BLOQUEADA' },
      });
      expect(await codigoDoErro(servico.renovar('r'))).toBe(
        'CONTA_INDISPONIVEL',
      );
      expect(revogadas.revogar).toHaveBeenCalledWith('s1', 900);
    });
  });

  it('deve apagar a sessão e revogar o access token quando encerra', async () => {
    await servico.encerrar('s1');
    expect(prisma.sessao.deleteMany).toHaveBeenCalledWith({
      where: { id: 's1' },
    });
    expect(revogadas.revogar).toHaveBeenCalledWith('s1', 900);
  });
});
