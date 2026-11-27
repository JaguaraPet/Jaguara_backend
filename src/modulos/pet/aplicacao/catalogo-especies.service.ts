import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { CATALOGO_ESPECIES } from '../dominio/catalogo-especies';

type PrismaCatalogo = Pick<PrismaService, 'especie' | 'raca'>;

/**
 * Garante no banco as espécies e raças do código, em todo ambiente, na inicialização da API.
 * Só acrescenta o que falta: nada é apagado nem renomeado.
 */
@Injectable()
export class CatalogoEspeciesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CatalogoEspeciesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    // Os testes montam o próprio catálogo e conferem a lista exata.
    if (process.env.NODE_ENV === 'test') return;
    const criadas = await sincronizarEspecies(this.prisma);
    if (criadas)
      this.logger.log(`Catálogo de espécies: ${criadas} raças acrescentadas`);
  }
}

/** Acrescenta as espécies e raças que faltam; devolve quantas raças foram criadas. */
export async function sincronizarEspecies(
  prisma: PrismaCatalogo,
): Promise<number> {
  let criadas = 0;
  for (const [nome, racas] of Object.entries(CATALOGO_ESPECIES)) {
    const especie = await prisma.especie.upsert({
      where: { nome },
      create: { nome },
      update: {},
    });
    const existentes = await prisma.raca.findMany({
      where: { especieId: especie.id },
      select: { nome: true },
    });
    const nomes = new Set(existentes.map((r) => r.nome));
    const faltam = racas.filter((r) => !nomes.has(r));
    if (faltam.length) {
      await prisma.raca.createMany({
        data: faltam.map((r) => ({ nome: r, especieId: especie.id })),
      });
      criadas += faltam.length;
    }
  }
  return criadas;
}
