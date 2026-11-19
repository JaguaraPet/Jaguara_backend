import { ConfigService } from '@nestjs/config';
import { Ambiente } from '../../../compartilhado/config/ambiente';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { FilaEmailService } from '../../notificacao/aplicacao/fila-email.service';
import { CadastroService, DadosEmpresa, DadosTutor } from './cadastro.service';
import { CatalogoAcessoService } from './catalogo-acesso.service';

const tutor: DadosTutor = {
  nome: 'Ana',
  cpf: '52998224725',
  email: ' Ana@Exemplo.com ',
  senha: 'senhaForte1',
};

const empresa: DadosEmpresa = {
  cnpj: '11222333000181',
  razaoSocial: 'Clínica Ltda.',
  nomeFantasia: 'Clínica',
  tipo: 'CLINICA_VETERINARIA',
  email: 'clinica@exemplo.com',
  senha: 'senhaForte1',
  endereco: {
    cep: '05400000',
    logradouro: 'Rua A',
    numero: '1',
    bairro: 'B',
    cidade: 'C',
    uf: 'SP',
  },
};

type Mocks = Record<string, Record<string, jest.Mock>>;

function criarPrisma(): Mocks & { $transaction: jest.Mock } {
  const prisma = {
    usuario: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'u1' }),
      update: jest.fn(),
    },
    tutor: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
    empresaEnterprise: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    perfilAcesso: {
      findFirstOrThrow: jest.fn().mockResolvedValue({ id: 'p1' }),
    },
    termoUso: { findFirst: jest.fn().mockResolvedValue({ id: 't1' }) },
    consentimento: { createMany: jest.fn() },
    tokenAcesso: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  } as unknown as Mocks & { $transaction: jest.Mock };
  prisma.$transaction = jest.fn((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: unknown) => unknown)(prisma)
      : Promise.all(arg as unknown[]),
  );
  return prisma;
}

async function codigo(promessa: Promise<unknown>) {
  try {
    await promessa;
    return 'SEM_ERRO';
  } catch (erro) {
    return (erro as ErroNegocio).codigo;
  }
}

describe('CadastroService', () => {
  let prisma: ReturnType<typeof criarPrisma>;
  let fila: { enviar: jest.Mock };
  let catalogo: { criarPerfisDaEmpresa: jest.Mock };
  let servico: CadastroService;

  beforeEach(() => {
    prisma = criarPrisma();
    fila = { enviar: jest.fn().mockResolvedValue(undefined) };
    catalogo = { criarPerfisDaEmpresa: jest.fn().mockResolvedValue(undefined) };
    const valores: Record<string, string> = {
      CHAVE_CRIPTOGRAFIA: Buffer.alloc(32, 3).toString('base64'),
      URL_WEB: 'http://localhost:5173',
    };
    const config = { get: jest.fn((chave: string) => valores[chave]) };
    servico = new CadastroService(
      prisma as unknown as PrismaService,
      fila as unknown as FilaEmailService,
      catalogo as unknown as CatalogoAcessoService,
      config as unknown as ConfigService<Ambiente, true>,
    );
  });

  it('deve criar o tutor pendente, registrar os aceites e enviar o link quando os dados estão certos', async () => {
    const criado = await servico.cadastrarTutor(tutor, '127.0.0.1');

    expect(criado).toEqual({
      id: 'u1',
      email: 'ana@exemplo.com',
      status: 'PENDENTE_CONFIRMACAO',
      perfil: 'Tutor',
    });
    const usuario = (
      prisma.usuario.create.mock.calls[0] as [
        { data: { status: string; senhaHash: string } },
      ]
    )[0];
    expect(usuario.data.status).toBe('PENDENTE_CONFIRMACAO');
    expect(usuario.data.senhaHash).toMatch(/^\$argon2id\$/);
    expect(prisma.consentimento.createMany).toHaveBeenCalled();
    const token = (
      prisma.tokenAcesso.create.mock.calls[0] as [
        { data: { token: string; tipo: string } },
      ]
    )[0];
    expect(token.data.tipo).toBe('CONFIRMACAO_EMAIL');
    const link = (
      fila.enviar.mock.calls[0] as [string, string, { link: string }]
    )[2].link;
    expect(link).toContain('/confirmar-email?token=');
    expect(link).not.toContain(token.data.token);
  });

  it('deve recusar quando o CPF tem dígitos errados', async () => {
    expect(
      await codigo(
        servico.cadastrarTutor({ ...tutor, cpf: '52998224724' }, 'ip'),
      ),
    ).toBe('DADOS_INVALIDOS');
  });

  it('deve recusar quando a senha não tem número', async () => {
    expect(
      await codigo(
        servico.cadastrarTutor({ ...tutor, senha: 'semnumeros' }, 'ip'),
      ),
    ).toBe('DADOS_INVALIDOS');
  });

  it('deve recusar quando o e-mail já existe', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 'x' });
    expect(await codigo(servico.cadastrarTutor(tutor, 'ip'))).toBe(
      'EMAIL_EM_USO',
    );
  });

  it('deve recusar quando o CPF já existe (RN01)', async () => {
    prisma.tutor.findUnique.mockResolvedValue({ id: 'x' });
    expect(await codigo(servico.cadastrarTutor(tutor, 'ip'))).toBe(
      'RN01_CPF_EM_USO',
    );
  });

  it('deve recusar quando não há termos vigentes publicados (RN42)', async () => {
    prisma.termoUso.findFirst.mockResolvedValue(null);
    expect(await codigo(servico.cadastrarTutor(tutor, 'ip'))).toBe(
      'TERMOS_INDISPONIVEIS',
    );
  });

  it('deve criar a empresa com os perfis padrão quando os dados estão certos (UC-32)', async () => {
    const criado = await servico.cadastrarEmpresa(empresa, 'ip');
    expect(criado.perfil).toBe('Empresa');
    expect(catalogo.criarPerfisDaEmpresa).toHaveBeenCalledWith('u1', prisma);
    expect(fila.enviar).toHaveBeenCalledWith(
      'CONFIRMACAO_CADASTRO',
      'clinica@exemplo.com',
      expect.anything(),
    );
  });

  it('deve recusar a empresa quando o CNPJ é inválido ou já existe (RN01)', async () => {
    expect(
      await codigo(
        servico.cadastrarEmpresa({ ...empresa, cnpj: '11222333000180' }, 'ip'),
      ),
    ).toBe('DADOS_INVALIDOS');
    prisma.empresaEnterprise.findUnique.mockResolvedValue({ id: 'x' });
    expect(await codigo(servico.cadastrarEmpresa(empresa, 'ip'))).toBe(
      'RN01_CNPJ_EM_USO',
    );
  });

  it('deve ativar a conta quando o link é válido (RN02)', async () => {
    prisma.tokenAcesso.findUnique.mockResolvedValue({
      id: 'k1',
      usuarioId: 'u1',
      tipo: 'CONFIRMACAO_EMAIL',
      utilizado: false,
      expiraEm: new Date(Date.now() + 60_000),
    });
    await servico.confirmarEmail('abc');
    expect(prisma.usuario.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { emailConfirmado: true, status: 'ATIVA' },
    });
  });

  it('deve recusar o link quando venceu ou já foi usado', async () => {
    prisma.tokenAcesso.findUnique.mockResolvedValue({
      id: 'k1',
      usuarioId: 'u1',
      tipo: 'CONFIRMACAO_EMAIL',
      utilizado: true,
      expiraEm: new Date(Date.now() + 60_000),
    });
    expect(await codigo(servico.confirmarEmail('abc'))).toBe('LINK_EXPIRADO');
    prisma.tokenAcesso.findUnique.mockResolvedValue(null);
    expect(await codigo(servico.confirmarEmail('abc'))).toBe('LINK_EXPIRADO');
  });
});
