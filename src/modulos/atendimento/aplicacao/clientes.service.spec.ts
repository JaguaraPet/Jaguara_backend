import { ConfigService } from '@nestjs/config';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Ambiente } from '../../../compartilhado/config/ambiente';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { FilaEmailService } from '../../notificacao/aplicacao/fila-email.service';
import { ClientesService } from './clientes.service';

const funcionario: UsuarioAutenticado = {
  sub: 'f1',
  sid: 's',
  tipo: 'FUNCIONARIO',
  perfil: 'Atendente',
  empresaId: 'e1',
  permissoes: [],
};

const agora = new Date();
const clienteBanco = (extra: Record<string, unknown> = {}) => ({
  id: 'c1',
  codigo: 'CLI-0001',
  nome: 'Maria',
  cpfCifrado: null,
  telefone: null,
  email: 'maria@exemplo.com',
  tutorId: null,
  ativo: true,
  empresaId: 'e1',
  clientePet: [],
  consentimento: [{ id: 'k1', aceito: true, dataRevogacao: null }],
  ...extra,
});

async function codigo(promessa: Promise<unknown>) {
  try {
    await promessa;
    return 'SEM_ERRO';
  } catch (erro) {
    return (erro as ErroNegocio).codigo;
  }
}

describe('ClientesService', () => {
  let prisma: Record<string, Record<string, jest.Mock>> & {
    $transaction: jest.Mock;
  };
  let fila: { enviar: jest.Mock };
  let servico: ClientesService;

  beforeEach(() => {
    prisma = {
      cliente: {
        findMany: jest.fn().mockResolvedValue([clienteBanco()]),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue(
          clienteBanco({
            consentimento: [{ aceito: false, dataRevogacao: null }],
          }),
        ),
        update: jest.fn(),
        delete: jest.fn(),
      },
      termoUso: { findFirst: jest.fn().mockResolvedValue({ id: 't1' }) },
      tutor: { findFirst: jest.fn().mockResolvedValue(null) },
      empresaEnterprise: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ nomeFantasia: 'Clínica' }),
      },
      raca: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ nome: 'SRD', especie: { nome: 'Cachorro' } }),
      },
      pet: {
        create: jest.fn().mockResolvedValue({
          id: 'p1',
          nome: 'Rex',
          racaId: 'r1',
          sexo: 'MACHO',
          castrado: false,
          cor: null,
          microchip: null,
          status: 'ATIVO',
        }),
      },
      consentimento: {
        findUnique: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      responsavelPet: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    } as unknown as typeof prisma;
    prisma.$transaction = jest.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => unknown)(prisma)
        : Promise.all(arg as unknown[]),
    );
    fila = { enviar: jest.fn().mockResolvedValue(undefined) };
    const valores: Record<string, unknown> = {
      CHAVE_CRIPTOGRAFIA: Buffer.alloc(32, 5).toString('base64'),
      URL_WEB: 'http://localhost:5173',
    };
    servico = new ClientesService(
      prisma as unknown as PrismaService,
      fila as unknown as FilaEmailService,
      { get: jest.fn((c: string) => valores[c]) } as unknown as ConfigService<
        Ambiente,
        true
      >,
    );
  });

  it('deve listar com a situação do consentimento', async () => {
    expect(await servico.listar(funcionario, 'e1')).toEqual([
      expect.objectContaining({
        id: 'c1',
        consentimento: 'VIGENTE',
        possuiConta: false,
      }),
    ]);
  });

  it('deve criar o pré-cadastro só com nome e contato e enviar o link do termo', async () => {
    const criado = await servico.cadastrar(
      funcionario,
      'e1',
      {
        nome: 'João',
        cpf: '52998224725',
        email: 'Joao@Exemplo.com',
        meioConsentimento: 'LINK_DIGITAL',
      },
      '1.2.3.4',
    );
    const dados = (
      prisma.cliente.create.mock.calls[0] as [{ data: Record<string, unknown> }]
    )[0].data;
    expect(dados.cpfCifrado).toBeUndefined();
    expect(dados).toMatchObject({
      email: 'joao@exemplo.com',
      codigo: 'CLI-0001',
    });
    expect(criado.linkTermo).toMatch(/\/termo\//);
    expect(fila.enviar).toHaveBeenCalledWith(
      'TERMO_CLIENTE',
      'joao@exemplo.com',
      expect.anything(),
    );
  });

  it('deve validar o meio de consentimento, o CPF e o termo publicado', async () => {
    expect(
      await codigo(
        servico.cadastrar(
          funcionario,
          'e1',
          { nome: 'A', meioConsentimento: 'ASSINATURA_PRESENCIAL' },
          'ip',
        ),
      ),
    ).toBe('DADOS_INVALIDOS');
    expect(
      await codigo(
        servico.cadastrar(
          funcionario,
          'e1',
          { nome: 'A', meioConsentimento: 'LINK_DIGITAL' },
          'ip',
        ),
      ),
    ).toBe('DADOS_INVALIDOS');
    expect(
      await codigo(
        servico.cadastrar(
          funcionario,
          'e1',
          {
            nome: 'A',
            cpf: '52998224724',
            email: 'a@x.com',
            meioConsentimento: 'LINK_DIGITAL',
          },
          'ip',
        ),
      ),
    ).toBe('DADOS_INVALIDOS');
    prisma.termoUso.findFirst.mockResolvedValueOnce(null);
    expect(
      await codigo(
        servico.cadastrar(
          funcionario,
          'e1',
          { nome: 'A', email: 'a@x.com', meioConsentimento: 'LINK_DIGITAL' },
          'ip',
        ),
      ),
    ).toBe('TERMOS_INDISPONIVEIS');
  });

  it('deve recusar quando a pessoa já é cliente da empresa (RN25)', async () => {
    prisma.tutor.findFirst.mockResolvedValue({ id: 't1' });
    prisma.cliente.findFirst.mockResolvedValueOnce({ id: 'c9' });
    expect(
      await codigo(
        servico.cadastrar(
          funcionario,
          'e1',
          { nome: 'A', email: 'a@x.com', meioConsentimento: 'LINK_DIGITAL' },
          'ip',
        ),
      ),
    ).toBe('RN25_CLIENTE_EXISTENTE');
  });

  it('deve cadastrar o pet só com consentimento vigente e sem conta (RN41, ADR-010)', async () => {
    prisma.cliente.findFirst.mockResolvedValue(clienteBanco());
    const pet = await servico.cadastrarPet(funcionario, 'e1', 'c1', {
      nome: 'Rex',
      racaId: 'r1',
      sexo: 'MACHO',
      castrado: false,
    });
    expect(pet).toMatchObject({ raca: 'SRD', especie: 'Cachorro' });

    prisma.cliente.findFirst.mockResolvedValue(
      clienteBanco({ consentimento: [{ aceito: false, dataRevogacao: null }] }),
    );
    expect(
      await codigo(
        servico.cadastrarPet(funcionario, 'e1', 'c1', {
          nome: 'Rex',
          racaId: 'r1',
          sexo: 'MACHO',
          castrado: false,
        }),
      ),
    ).toBe('RN41_SEM_CONSENTIMENTO');

    prisma.cliente.findFirst.mockResolvedValue(clienteBanco({ tutorId: 't1' }));
    expect(
      await codigo(
        servico.cadastrarPet(funcionario, 'e1', 'c1', {
          nome: 'Rex',
          racaId: 'r1',
          sexo: 'MACHO',
          castrado: false,
        }),
      ),
    ).toBe('CLIENTE_COM_CONTA');

    prisma.cliente.findFirst.mockResolvedValue(null);
    expect(
      await codigo(
        servico.cadastrarPet(funcionario, 'e1', 'c1', {
          nome: 'Rex',
          racaId: 'r1',
          sexo: 'MACHO',
          castrado: false,
        }),
      ),
    ).toBe('NAO_ENCONTRADO');
  });

  it('deve aceitar pelo link e mandar o comprovante (CT-21-04)', async () => {
    prisma.consentimento.findUnique.mockResolvedValue({
      id: 'k1',
      aceito: false,
      dataRevogacao: null,
      criadoEm: agora,
      clienteId: 'c1',
      termo: { versao: '1.0' },
      cliente: {
        nome: 'Maria',
        email: 'maria@exemplo.com',
        empresaId: 'e1',
        empresa: { nomeFantasia: 'Clínica' },
      },
    });
    await servico.aceitar('token', '1.2.3.4');
    expect(prisma.consentimento.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          aceito: true,
          ipOrigem: '1.2.3.4',
        }) as object,
      }),
    );
    expect(fila.enviar).toHaveBeenCalledWith(
      'COMPROVANTE_CONSENTIMENTO',
      'maria@exemplo.com',
      expect.anything(),
    );
  });

  it('deve recusar o link vencido ou desconhecido', async () => {
    prisma.consentimento.findUnique.mockResolvedValue(null);
    expect(await codigo(servico.abrirTermo('x'))).toBe('NAO_ENCONTRADO');
    prisma.consentimento.findUnique.mockResolvedValue({
      aceito: false,
      dataRevogacao: null,
      criadoEm: new Date(Date.now() - 8 * 86_400_000),
      termo: {},
      cliente: { empresa: { nomeFantasia: 'Clínica' } },
    });
    expect(await codigo(servico.aceitar('x', 'ip'))).toBe('LINK_EXPIRADO');
  });

  it('deve revogar e anonimizar quando a empresa registra o pedido do cliente', async () => {
    prisma.cliente.findFirst.mockResolvedValue(clienteBanco());
    await servico.revogarPelaEmpresa(funcionario, 'e1', 'c1');
    expect(prisma.cliente.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ativo: false,
          nome: 'Cliente removido',
          email: null,
        }) as object,
      }),
    );
  });

  it('deve ligar o tutor ao cliente e torná-lo responsável principal do pet (RC-33)', async () => {
    prisma.cliente.findMany.mockResolvedValue([
      clienteBanco({ clientePet: [{ petId: 'p1' }] }),
    ]);
    await servico.vincularTutor(
      prisma as never,
      't1',
      'maria@exemplo.com',
      'hash',
    );
    expect(prisma.cliente.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { tutorId: 't1' },
    });
    expect(prisma.responsavelPet.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        petId: 'p1',
        tutorId: 't1',
        tipo: 'PRINCIPAL',
      }) as object,
    });
  });

  it('deve excluir os pré-cadastros vencidos (CT-21-05)', async () => {
    prisma.cliente.findMany.mockResolvedValue([{ id: 'c1', empresaId: 'e1' }]);
    expect(await servico.limparPreCadastros()).toBe(1);
    expect(prisma.cliente.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
  });
});
