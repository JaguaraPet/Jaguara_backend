import { ConfigService } from '@nestjs/config';
import { SessoesRevogadas } from '../../../compartilhado/auth/sessoes-revogadas';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Ambiente } from '../../../compartilhado/config/ambiente';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { FilaEmailService } from '../../notificacao/aplicacao/fila-email.service';
import { FuncionariosService } from './funcionarios.service';

const empresa: UsuarioAutenticado = {
  sub: 'e1',
  sid: 's',
  tipo: 'EMPRESA',
  perfil: 'Empresa',
  empresaId: 'e1',
  permissoes: ['funcionario:editar', 'funcionario:ler'],
};

const registro = {
  id: 'f1',
  nome: 'Rafa',
  cargo: null,
  ativo: true,
  empresaId: 'e1',
  usuario: {
    email: 'rafa@exemplo.com',
    status: 'ATIVA',
    perfil: { id: 'p1', nome: 'Atendente' },
  },
};

async function codigo(promessa: Promise<unknown>) {
  try {
    await promessa;
    return 'SEM_ERRO';
  } catch (erro) {
    return (erro as ErroNegocio).codigo;
  }
}

describe('FuncionariosService', () => {
  let prisma: Record<string, Record<string, jest.Mock>> & {
    $transaction: jest.Mock;
  };
  let fila: { enviar: jest.Mock };
  let revogadas: { revogar: jest.Mock };
  let servico: FuncionariosService;

  beforeEach(() => {
    prisma = {
      funcionarioEnterprise: {
        findMany: jest.fn().mockResolvedValue([registro]),
        findUnique: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn().mockResolvedValue(registro),
        create: jest.fn().mockResolvedValue(registro),
        update: jest.fn(),
      },
      usuario: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'f1' }),
        update: jest.fn(),
      },
      perfilAcesso: {
        findUnique: jest.fn().mockResolvedValue({ id: 'p1', empresaId: 'e1' }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'p1',
            nome: 'Atendente',
            descricao: null,
            perfilPermissao: [
              { permissao: { codigo: 'cliente:ler' } },
              { permissao: { codigo: 'agenda:ler' } },
            ],
          },
        ]),
      },
      empresaEnterprise: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ nomeFantasia: 'Clínica' }),
      },
      tokenAcesso: { create: jest.fn() },
      sessao: {
        findMany: jest.fn().mockResolvedValue([{ id: 's1' }, { id: 's2' }]),
        deleteMany: jest.fn(),
      },
    } as unknown as typeof prisma;
    prisma.$transaction = jest.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => unknown)(prisma)
        : Promise.all(arg as unknown[]),
    );
    fila = { enviar: jest.fn().mockResolvedValue(undefined) };
    revogadas = { revogar: jest.fn().mockResolvedValue(undefined) };
    const valores: Record<string, unknown> = {
      CHAVE_CRIPTOGRAFIA: Buffer.alloc(32, 4).toString('base64'),
      URL_WEB: 'http://localhost:5173',
      JWT_EXPIRACAO_MINUTOS: 15,
    };
    servico = new FuncionariosService(
      prisma as unknown as PrismaService,
      fila as unknown as FilaEmailService,
      revogadas as unknown as SessoesRevogadas,
      { get: jest.fn((c: string) => valores[c]) } as unknown as ConfigService<
        Ambiente,
        true
      >,
    );
  });

  it('deve listar a equipe no formato do contrato', async () => {
    expect(await servico.listar(empresa, 'e1')).toEqual([
      {
        id: 'f1',
        nome: 'Rafa',
        email: 'rafa@exemplo.com',
        cargo: null,
        perfil: 'Atendente',
        perfilId: 'p1',
        ativo: true,
        pendente: false,
      },
    ]);
  });

  it('deve listar os perfis da empresa com as permissões (UC-16)', async () => {
    expect(await servico.perfis(empresa, 'e1')).toEqual([
      {
        id: 'p1',
        nome: 'Atendente',
        descricao: undefined,
        permissoes: ['agenda:ler', 'cliente:ler'],
      },
    ]);
    expect(await codigo(servico.perfis(empresa, 'e2'))).toBe('SEM_PERMISSAO');
  });

  it('deve negar a equipe de outra empresa (RN24)', async () => {
    expect(await codigo(servico.listar(empresa, 'e2'))).toBe('SEM_PERMISSAO');
  });

  it('deve cadastrar sem senha e enviar o convite quando os dados estão certos', async () => {
    await servico.cadastrar(empresa, 'e1', {
      nome: 'Rafa',
      cpf: '52998224725',
      email: 'Rafa@Exemplo.com',
      perfilId: 'p1',
    });
    const conta = (
      prisma.usuario.create.mock.calls[0] as [{ data: Record<string, unknown> }]
    )[0].data;
    expect(conta).toMatchObject({
      email: 'rafa@exemplo.com',
      status: 'PENDENTE_CONFIRMACAO',
    });
    expect(conta.senhaHash).toBeUndefined();
    expect(fila.enviar).toHaveBeenCalledWith(
      'CONVITE_FUNCIONARIO',
      'rafa@exemplo.com',
      expect.objectContaining({ empresa: 'Clínica' }),
    );
  });

  it('deve recusar perfil de outra empresa, CPF inválido e duplicidades', async () => {
    prisma.perfilAcesso.findUnique.mockResolvedValueOnce({
      id: 'p9',
      empresaId: 'e9',
    });
    expect(
      await codigo(
        servico.cadastrar(empresa, 'e1', {
          nome: 'A',
          cpf: '52998224725',
          email: 'a@x.com',
          perfilId: 'p9',
        }),
      ),
    ).toBe('DADOS_INVALIDOS');
    expect(
      await codigo(
        servico.cadastrar(empresa, 'e1', {
          nome: 'A',
          cpf: '52998224724',
          email: 'a@x.com',
          perfilId: 'p1',
        }),
      ),
    ).toBe('DADOS_INVALIDOS');
    prisma.usuario.findUnique.mockResolvedValueOnce({ id: 'x' });
    expect(
      await codigo(
        servico.cadastrar(empresa, 'e1', {
          nome: 'A',
          cpf: '52998224725',
          email: 'a@x.com',
          perfilId: 'p1',
        }),
      ),
    ).toBe('EMAIL_EM_USO');
    prisma.funcionarioEnterprise.findUnique.mockResolvedValueOnce({ id: 'x' });
    expect(
      await codigo(
        servico.cadastrar(empresa, 'e1', {
          nome: 'A',
          cpf: '52998224725',
          email: 'a@x.com',
          perfilId: 'p1',
        }),
      ),
    ).toBe('RN01_CPF_EM_USO');
  });

  it('deve trocar o perfil e encerrar as sessões quando a empresa altera o funcionário (RN20)', async () => {
    prisma.funcionarioEnterprise.findUnique.mockResolvedValue(registro);
    await servico.alterarPerfil(empresa, 'f1', 'p1');
    expect(prisma.usuario.update).toHaveBeenCalledWith({
      where: { id: 'f1' },
      data: { perfilId: 'p1' },
    });
    expect(revogadas.revogar).toHaveBeenCalledTimes(2);
  });

  it('deve desativar a conta e revogar todas as sessões quando desliga o funcionário (RN23)', async () => {
    prisma.funcionarioEnterprise.findUnique.mockResolvedValue(registro);
    await servico.desligar(empresa, 'f1');
    expect(prisma.usuario.update).toHaveBeenCalledWith({
      where: { id: 'f1' },
      data: { status: 'INATIVA' },
    });
    expect(prisma.sessao.deleteMany).toHaveBeenCalledWith({
      where: { usuarioId: 'f1' },
    });
    expect(revogadas.revogar).toHaveBeenCalledWith('s1', 900);
    expect(revogadas.revogar).toHaveBeenCalledWith('s2', 900);
  });

  it('deve responder 404 quando o funcionário não existe', async () => {
    expect(await codigo(servico.desligar(empresa, 'nao-existe'))).toBe(
      'NAO_ENCONTRADO',
    );
  });
});
