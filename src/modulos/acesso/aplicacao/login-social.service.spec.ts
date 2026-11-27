import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditoriaService } from '../../../compartilhado/auditoria/auditoria.service';
import { Ambiente } from '../../../compartilhado/config/ambiente';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { VerificadorIdentidade } from '../infra/verificador-identidade';
import { AutenticacaoService } from './autenticacao.service';
import { CadastroService } from './cadastro.service';
import { LoginSocialService } from './login-social.service';

const agora = Math.floor(Date.now() / 1000);
const claims = {
  iss: 'https://accounts.google.com',
  aud: 'cliente-google',
  sub: 'g-1',
  exp: agora + 600,
  email: 'ana@gmail.com',
  email_verified: true,
  nonce: 'n1',
  name: 'Ana',
};
const tokens = { accessToken: 'a', refreshToken: 'r', expiraEm: 'x' };

function montar(
  opcoes: {
    ligada?: boolean;
    conta?: boolean;
    senhaOk?: boolean;
    ids?: string;
  } = {},
) {
  const prisma = {
    identidadeExterna: {
      findUnique: jest
        .fn()
        .mockResolvedValue(opcoes.ligada ? { usuarioId: 'u1' } : null),
      create: jest.fn(),
    },
    usuario: {
      findUnique: jest
        .fn()
        .mockResolvedValue(opcoes.conta ? { id: 'u2' } : null),
    },
  };
  const autenticacao = {
    abrirSessao: jest.fn().mockResolvedValue(tokens),
    senhaConfere: jest.fn().mockResolvedValue(opcoes.senhaOk ?? false),
  };
  const cadastro = { cadastrarTutorSocial: jest.fn().mockResolvedValue('u3') };
  const verificador = { verificar: jest.fn().mockResolvedValue(claims) };
  const auditoria = { registrar: jest.fn() };
  const config = {
    get: (chave: string) =>
      chave === 'GOOGLE_LOGIN_CLIENT_IDS'
        ? (opcoes.ids ?? 'cliente-google')
        : undefined,
  };
  const jwt = new JwtService({
    secret: 'segredo-de-teste-com-mais-de-32-caracteres',
  });
  const servico = new LoginSocialService(
    prisma as unknown as PrismaService,
    jwt,
    config as unknown as ConfigService<Ambiente, true>,
    verificador as unknown as VerificadorIdentidade,
    autenticacao as unknown as AutenticacaoService,
    cadastro as unknown as CadastroService,
    auditoria as unknown as AuditoriaService,
  );
  return { servico, prisma, autenticacao, cadastro, verificador, auditoria };
}

const codigo = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: ErroNegocio) => e.codigo,
  );
const pedido = {
  provedor: 'GOOGLE' as const,
  idToken: 'id.token.x',
  nonce: 'n1',
};

describe('LoginSocialService (UC-02 FA04, RF46)', () => {
  it('CT-02-03: deve abrir a sessão da conta já ligada à identidade', async () => {
    const { servico, autenticacao } = montar({ ligada: true });
    await expect(servico.entrar(pedido, 'app')).resolves.toEqual({
      tipo: 'sessao',
      tokens,
    });
    expect(autenticacao.abrirSessao).toHaveBeenCalledWith('u1', 'app');
  });

  it('CT-02-04: deve pedir a senha da conta com o mesmo e-mail antes de ligar', async () => {
    const sem = montar({ conta: true });
    expect(await codigo(sem.servico.entrar(pedido))).toBe(
      'IDENTIDADE_SEM_VINCULO',
    );
    expect(sem.prisma.identidadeExterna.create).not.toHaveBeenCalled();

    const errada = montar({ conta: true, senhaOk: false });
    expect(await codigo(errada.servico.entrar({ ...pedido, senha: 'x' }))).toBe(
      'SENHA_INCORRETA_VINCULO',
    );

    const certa = montar({ conta: true, senhaOk: true });
    await expect(
      certa.servico.entrar({ ...pedido, senha: 'Senha@123' }),
    ).resolves.toEqual({ tipo: 'sessao', tokens });
    expect(certa.prisma.identidadeExterna.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provedor: 'GOOGLE',
        idExterno: 'g-1',
        usuarioId: 'u2',
      }) as unknown,
    });
    expect(certa.auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ acao: 'IDENTIDADE_EXTERNA_VINCULADA' }),
    );
  });

  it('deve devolver o token de cadastro no primeiro acesso e concluir com CPF', async () => {
    const { servico, cadastro, autenticacao } = montar();
    const resultado = await servico.entrar(pedido);
    if (resultado.tipo !== 'cadastro') throw new Error('esperava cadastro');
    expect(resultado.pendente).toMatchObject({
      nome: 'Ana',
      email: 'ana@gmail.com',
    });

    await expect(
      servico.concluirCadastro(
        {
          cadastroToken: resultado.pendente.cadastroToken,
          nome: 'Ana Ribeiro',
          cpf: '52998224725',
        },
        '127.0.0.1',
      ),
    ).resolves.toEqual(tokens);
    expect(cadastro.cadastrarTutorSocial).toHaveBeenCalledWith(
      {
        nome: 'Ana Ribeiro',
        cpf: '52998224725',
        email: 'ana@gmail.com',
        telefone: undefined,
      },
      { provedor: 'GOOGLE', idExterno: 'g-1' },
      '127.0.0.1',
    );
    expect(autenticacao.abrirSessao).toHaveBeenCalledWith('u3', undefined);
    expect(
      await codigo(
        servico.concluirCadastro(
          { cadastroToken: 'falso', nome: 'A', cpf: '1' },
          'ip',
        ),
      ),
    ).toBe('LINK_EXPIRADO');
  });

  it('deve recusar token inválido e avisar quando o provedor não está configurado', async () => {
    const recusado = montar();
    recusado.verificador.verificar.mockResolvedValue(null);
    expect(await codigo(recusado.servico.entrar(pedido))).toBe(
      'NAO_AUTENTICADO',
    );

    const outroApp = montar();
    outroApp.verificador.verificar.mockResolvedValue({
      ...claims,
      aud: 'outro-app',
    });
    expect(await codigo(outroApp.servico.entrar(pedido))).toBe(
      'NAO_AUTENTICADO',
    );

    expect(await codigo(montar({ ids: '' }).servico.entrar(pedido))).toBe(
      'LOGIN_SOCIAL_INDISPONIVEL',
    );
  });
});
