import { PrismaClient } from '../src/generated/prisma/client';
import { criarPrismaTeste, limparBanco } from './utils/banco';

describe('Banco de teste (integração)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('deve ter as 57 tabelas do MOD-03 e as novas (push, demonstração, rotinas e doses) quando as migrações são aplicadas', async () => {
    const [{ total }] = await prisma.$queryRaw<{ total: bigint }[]>`
      SELECT count(*) AS total FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'`;
    expect(Number(total)).toBe(62);
  });

  it('deve recusar conta ativa sem e-mail confirmado (RN02) quando grava no banco', async () => {
    const perfil = await prisma.perfilAcesso.create({
      data: { nome: 'Tutor', escopo: 'GLOBAL' },
    });
    await expect(
      prisma.usuario.create({
        data: {
          email: 'sem.confirmacao@exemplo.com',
          emailConfirmado: false,
          status: 'ATIVA',
          tentativasLoginFalhas: 0,
          dataCadastro: new Date(),
          perfilId: perfil.id,
        },
      }),
    ).rejects.toThrow();
  });
});
