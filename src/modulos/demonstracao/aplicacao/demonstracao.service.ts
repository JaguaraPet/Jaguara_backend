import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { Cifragem } from '../../../compartilhado/cripto/cifragem';
import { Ambiente } from '../../../compartilhado/config/ambiente';
import { ErroNegocio, Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import {
  AutenticacaoService,
  Tokens,
} from '../../acesso/aplicacao/autenticacao.service';
import { criarClinicaDemonstracao } from './clinica-demonstracao';

export interface DemonstracaoCriada {
  sessao: Tokens;
  /** Código de uso único para entrar como a tutora da demonstração no app. */
  codigoTutor: string;
  expiraEm: string;
  formularioOpiniao: string | null;
  urlTutor: string | null;
}

/**
 * Demonstração pública: cada visitante ganha uma clínica própria e temporária, com dados
 * fictícios, e entra direto nela. A clínica não aparece na busca dos tutores, não envia e-mails
 * e é desativada quando expira.
 */
@Injectable()
export class DemonstracaoService {
  private readonly logger = new Logger(DemonstracaoService.name);
  private readonly cifragem: Cifragem;

  constructor(
    private readonly prisma: PrismaService,
    private readonly autenticacao: AutenticacaoService,
    private readonly config: ConfigService<Ambiente, true>,
  ) {
    this.cifragem = new Cifragem(
      this.config.get('CHAVE_CRIPTOGRAFIA', { infer: true }),
    );
  }

  private habilitada(): void {
    if (!this.config.get('DEMONSTRACAO_HABILITADA', { infer: true })) {
      throw Erros.naoEncontrado('Demonstração indisponível neste ambiente');
    }
  }

  async criar(ip?: string): Promise<DemonstracaoCriada> {
    this.habilitada();
    await this.expirarAntigas();
    const agora = new Date();
    const horas = this.config.get('DEMONSTRACAO_HORAS', { infer: true });
    const expiraEm = new Date(agora.getTime() + horas * 3_600_000);
    const sufixo = randomBytes(6).toString('hex');
    const codigoTutor = randomBytes(24).toString('base64url');

    const clinica = await this.prisma.$transaction(
      async (tx) => {
        const criada = await criarClinicaDemonstracao(tx, {
          agora,
          sufixo,
          cifragem: this.cifragem,
          senhaHash: null,
          ipOrigem: ip,
        });
        await tx.demonstracao.create({
          data: {
            empresaId: criada.empresaId,
            tutorId: criada.tutorId,
            codigoTutor: hash(codigoTutor),
            ipOrigem: ip?.slice(0, 255),
            expiraEm,
          },
        });
        return criada;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    this.logger.log(`Demonstração criada para a empresa ${clinica.empresaId}`);

    return {
      sessao: await this.autenticacao.abrirSessao(
        clinica.empresaId,
        'Demonstração',
      ),
      codigoTutor,
      expiraEm: expiraEm.toISOString(),
      formularioOpiniao:
        this.config.get('URL_FORMULARIO_OPINIAO', { infer: true }) ?? null,
      urlTutor: this.config.get('URL_TUTOR_WEB', { infer: true }) ?? null,
    };
  }

  /** Entra como a tutora da demonstração (o "Ver como tutor"). */
  async entrarComoTutor(codigo: string): Promise<Tokens> {
    this.habilitada();
    const demonstracao = await this.prisma.demonstracao.findUnique({
      where: { codigoTutor: hash(codigo) },
    });
    if (
      !demonstracao ||
      demonstracao.encerrada ||
      demonstracao.expiraEm <= new Date()
    ) {
      throw new ErroNegocio(
        HttpStatus.GONE,
        'demonstracao-expirada',
        'Esta demonstração expirou',
        'Comece uma nova demonstração na página do Jaguara.',
      );
    }
    return this.autenticacao.abrirSessao(demonstracao.tutorId, 'Demonstração');
  }

  /** Desativa as contas das demonstrações vencidas; os dados ficam, sem acesso. */
  async expirarAntigas(agora = new Date()): Promise<number> {
    const vencidas = await this.prisma.demonstracao.findMany({
      where: { encerrada: false, expiraEm: { lte: agora } },
      select: { id: true, empresaId: true, tutorId: true },
    });
    for (const d of vencidas) {
      const funcionarios = await this.prisma.funcionarioEnterprise.findMany({
        where: { empresaId: d.empresaId },
        select: { id: true },
      });
      const clientes = await this.prisma.cliente.findMany({
        where: { empresaId: d.empresaId, tutorId: { not: null } },
        select: { tutorId: true },
      });
      const ids = [
        d.empresaId,
        d.tutorId,
        ...funcionarios.map((f) => f.id),
        ...clientes.map((c) => c.tutorId!),
      ];
      await this.prisma.$transaction([
        this.prisma.usuario.updateMany({
          where: { id: { in: ids } },
          data: { status: 'INATIVA' },
        }),
        this.prisma.sessao.deleteMany({ where: { usuarioId: { in: ids } } }),
        this.prisma.demonstracao.update({
          where: { id: d.id },
          data: { encerrada: true },
        }),
      ]);
    }
    return vencidas.length;
  }
}

function hash(valor: string): string {
  return createHash('sha256').update(valor).digest('hex');
}
