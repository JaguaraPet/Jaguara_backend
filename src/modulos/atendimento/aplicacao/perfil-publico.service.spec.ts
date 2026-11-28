import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { gerarSlug, PADRAO_SLUG } from '../dominio/slug';
import { PerfilPublicoService } from './perfil-publico.service';

const empresa: UsuarioAutenticado = {
  sub: 'e1',
  sid: 's1',
  tipo: 'EMPRESA',
  perfil: 'Empresa',
  empresaId: 'e1',
  permissoes: ['empresa:editar'],
};

describe('Perfil público da empresa', () => {
  let prisma: { empresaEnterprise: Record<string, jest.Mock> };
  let servico: PerfilPublicoService;

  beforeEach(() => {
    prisma = {
      empresaEnterprise: {
        findUnique: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          slug: null,
          nomeFantasia: 'Clínica Patas & Cia',
        }),
        update: jest.fn((args: unknown) => Promise.resolve(args)),
      },
    };
    servico = new PerfilPublicoService(prisma as unknown as PrismaService);
  });

  it('deve gerar o endereço a partir do nome, sem acentos nem símbolos', () => {
    expect(gerarSlug('Clínica Patas & Cia')).toBe('clinica-patas-cia');
    expect(gerarSlug('  Pet Shop Cheiroso!! ')).toBe('pet-shop-cheiroso');
    expect(PADRAO_SLUG.test('clinica-patas')).toBe(true);
    expect(PADRAO_SLUG.test('-clinica')).toBe(false);
  });

  it('deve dar à empresa sem endereço o primeiro livre a partir do nome', async () => {
    prisma.empresaEnterprise.findUnique
      .mockResolvedValueOnce({ id: 'outra' })
      .mockResolvedValueOnce(null);
    expect(await servico.garantirSlug('e1')).toBe('clinica-patas-cia-2');
  });

  it('deve recusar endereço inválido, reservado ou de outra empresa', async () => {
    await expect(
      servico.atualizar(empresa, 'e1', { slug: 'A B' }),
    ).rejects.toBeInstanceOf(ErroNegocio);
    await expect(
      servico.atualizar(empresa, 'e1', { slug: 'admin' }),
    ).rejects.toBeInstanceOf(ErroNegocio);
    prisma.empresaEnterprise.findUnique.mockResolvedValue({ id: 'outra' });
    await expect(
      servico.atualizar(empresa, 'e1', { slug: 'clinica-patas' }),
    ).rejects.toBeInstanceOf(ErroNegocio);
  });

  it('deve limpar o @ do Instagram, apagar campos vazios e ignorar formas de pagamento desconhecidas', async () => {
    await servico.atualizar(empresa, 'e1', {
      instagram: '@patas.vet',
      descricao: '   ',
      formasPagamento: ['PIX', 'CHEQUE', 'PIX'],
    });
    const [[args]] = prisma.empresaEnterprise.update.mock.calls as [
      [{ data: Record<string, unknown> }],
    ];
    expect(args.data).toEqual({
      instagram: 'patas.vet',
      descricao: null,
      formasPagamento: ['PIX'],
    });
  });

  it('deve negar a edição do perfil de outra empresa', async () => {
    await expect(servico.atualizar(empresa, 'e2', {})).rejects.toBeInstanceOf(
      ErroNegocio,
    );
  });
});
