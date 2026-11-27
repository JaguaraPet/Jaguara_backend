import { randomBytes } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Cifragem } from '../src/compartilhado/cripto/cifragem';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarClinicaDemonstracao } from '../src/modulos/demonstracao/aplicacao/clinica-demonstracao';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';

describe('Demonstração pública (integração)', () => {
  let prisma: PrismaClient;
  let app: INestApplication;

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    // A API cria os perfis e os termos de que a demonstração precisa.
    app = await criarAppTeste();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('deve ter atendimentos no dia mesmo quando a demonstração abre num domingo', async () => {
    // Domingo, 22/11/2026, 8h em Brasília: antes do plantão começar.
    const domingo = new Date('2026-11-22T11:00:00Z');
    const { empresaId } = await prisma.$transaction(
      (tx) =>
        criarClinicaDemonstracao(tx, {
          agora: domingo,
          sufixo: 'domingo',
          cifragem: new Cifragem(randomBytes(32).toString('base64')),
          senhaHash: null,
        }),
      { timeout: 60_000 },
    );

    const doDia = await prisma.agendamento.findMany({
      where: {
        servico: { empresaId },
        dataHoraInicio: {
          gte: new Date('2026-11-22T03:00:00Z'),
          lt: new Date('2026-11-23T03:00:00Z'),
        },
      },
    });
    expect(doDia).toHaveLength(3);
    expect(doDia.every((a) => a.status === 'AGENDADO')).toBe(true);
  });
});
