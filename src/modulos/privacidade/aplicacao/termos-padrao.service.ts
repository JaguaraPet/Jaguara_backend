import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';

type PrismaTermos = Pick<PrismaService, 'termoUso'>;

const DOC =
  'https://github.com/JaguaraPet/Jaguara_doc/blob/main/docs/08-juridico';

/**
 * Versão 1.0 dos termos (JUR-01 a JUR-04). O texto completo fica no Jaguara_doc; aqui vai o
 * resumo exibido no aceite, com o link para o documento.
 */
export const TERMOS_PADRAO = [
  {
    tipo: 'TERMOS_USO_APP' as const,
    titulo: 'Termos de uso do app Jaguara',
    obrigatorio: true,
    conteudo: `O app Jaguara é gratuito para o tutor e organiza a saúde, a rotina e os agendamentos dos seus pets. Você é responsável pelas informações que cadastra e decide com quem compartilha os dados de cada pet. Texto completo: ${DOC}/JUR-01-termos-de-uso-app.md`,
  },
  {
    tipo: 'TERMOS_ENTERPRISE' as const,
    titulo: 'Termos de uso do Jaguara Enterprise',
    obrigatorio: true,
    conteudo: `O Jaguara Enterprise é o sistema da sua empresa para agenda, clientes, atendimento e pagamentos. A empresa só acessa os dados de pets que os tutores compartilharam e responde pelo uso que a equipe faz deles. Texto completo: ${DOC}/JUR-02-termos-enterprise.md`,
  },
  {
    tipo: 'POLITICA_PRIVACIDADE' as const,
    titulo: 'Política de privacidade',
    obrigatorio: true,
    conteudo: `Tratamos os seus dados para prestar o serviço, conforme a LGPD. Dados sensíveis, como o CPF, ficam cifrados; você pode pedir acesso, correção, portabilidade e exclusão a qualquer momento pelo app ou pela web. Texto completo: ${DOC}/JUR-03-politica-de-privacidade.md`,
  },
  {
    tipo: 'CONSENTIMENTO_CLIENTE' as const,
    titulo: 'Termo de consentimento do cliente',
    obrigatorio: true,
    conteudo: `Autorizo a empresa a registrar no Jaguara os meus dados de contato e os dados de saúde e atendimento dos meus pets, para o atendimento e o histórico. Posso revogar quando quiser. Texto completo: ${DOC}/JUR-04-termo-consentimento-cliente.md`,
  },
  {
    tipo: 'COMUNICACAO_MARKETING' as const,
    titulo: 'Comunicações de novidades',
    obrigatorio: false,
    conteudo:
      'Aceito receber novidades do Jaguara por e-mail. Posso cancelar quando quiser.',
  },
];

/**
 * Garante a versão 1.0 dos termos em todo ambiente, na inicialização da API. Sem eles, o
 * cadastro de tutores, de empresas e de clientes recusa com "termos indisponíveis", e em
 * produção o seed não roda. Só cria o tipo que ainda não tem nenhuma versão.
 */
@Injectable()
export class TermosPadraoService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TermosPadraoService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    // Os testes publicam os próprios termos.
    if (process.env.NODE_ENV === 'test') return;
    const criados = await garantirTermosPadrao(this.prisma);
    if (criados) this.logger.log(`Termos publicados: ${criados}`);
  }
}

export async function garantirTermosPadrao(
  prisma: PrismaTermos,
): Promise<number> {
  let criados = 0;
  for (const t of TERMOS_PADRAO) {
    const existe = await prisma.termoUso.findFirst({
      where: { tipo: t.tipo },
      select: { id: true },
    });
    if (existe) continue;
    await prisma.termoUso.create({
      data: {
        ...t,
        versao: '1.0',
        dataVigencia: new Date('2026-11-01T00:00:00Z'),
      },
    });
    criados++;
  }
  return criados;
}
