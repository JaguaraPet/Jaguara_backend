import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import { AuditoriaService } from '../../../compartilhado/auditoria/auditoria.service';
import { SessoesRevogadas } from '../../../compartilhado/auth/sessoes-revogadas';
import type { Ambiente } from '../../../compartilhado/config/ambiente';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { FilaEmailService } from '../../notificacao/aplicacao/fila-email.service';
import {
  MINUTOS_VALIDADE_RECUPERACAO,
  normalizarEmail,
  problemaNaSenha,
  SENHAS_ANTERIORES_BLOQUEADAS,
  tokenUtilizavel,
} from '../dominio/regras-cadastro';

const resumo = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/** Recuperação de senha (UC-03, RN05, RN06). */
@Injectable()
export class RecuperacaoSenhaService {
  private readonly log = new Logger(RecuperacaoSenhaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fila: FilaEmailService,
    private readonly config: ConfigService<Ambiente, true>,
    private readonly revogadas: SessoesRevogadas,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Envia o link de 2 horas (RN05). A resposta é a mesma exista ou não a conta, para não
   * revelar quais e-mails têm cadastro; um link novo invalida os anteriores.
   */
  async solicitar(emailInformado: string): Promise<void> {
    const email = normalizarEmail(emailInformado);
    const usuario = await this.prisma.usuario.findUnique({
      where: { email },
      select: {
        id: true,
        status: true,
        emailConfirmado: true,
        tutor: { select: { nome: true } },
        empresaEnterprise: { select: { nomeFantasia: true } },
        funcionarioEnterprise: { select: { nome: true } },
        administrador: { select: { nome: true } },
      },
    });
    if (
      !usuario ||
      !usuario.emailConfirmado ||
      !['ATIVA', 'BLOQUEADA'].includes(usuario.status)
    ) {
      this.log.debug('Recuperação pedida para e-mail sem conta ativa.');
      return;
    }
    const token = randomBytes(32).toString('base64url');
    const agora = new Date();
    await this.prisma.$transaction([
      this.prisma.tokenAcesso.updateMany({
        where: {
          usuarioId: usuario.id,
          tipo: 'RECUPERACAO_SENHA',
          utilizado: false,
        },
        data: { utilizado: true },
      }),
      this.prisma.tokenAcesso.create({
        data: {
          usuarioId: usuario.id,
          tipo: 'RECUPERACAO_SENHA',
          token: resumo(token),
          criadoEm: agora,
          expiraEm: new Date(
            agora.getTime() + MINUTOS_VALIDADE_RECUPERACAO * 60_000,
          ),
          utilizado: false,
        },
      }),
    ]);
    const nome =
      usuario.tutor?.nome ??
      usuario.funcionarioEnterprise?.nome ??
      usuario.empresaEnterprise?.nomeFantasia ??
      usuario.administrador?.nome ??
      'tudo bem';
    const url = this.config.get('URL_WEB', { infer: true }).split(',')[0];
    await this.fila.enviar('RECUPERACAO_SENHA', email, {
      nome,
      link: `${url}/redefinir-senha?token=${encodeURIComponent(token)}`,
      validadeMinutos: MINUTOS_VALIDADE_RECUPERACAO,
    });
  }

  /**
   * CT-03-01 e CT-03-02: o link vale uma vez e por 2 horas (RN05); a nova senha segue a
   * política e não repete as três últimas (RN06). Redefinir desbloqueia a conta e encerra as
   * sessões abertas.
   */
  async redefinir(token: string, novaSenha: string): Promise<void> {
    const registro = await this.prisma.tokenAcesso.findUnique({
      where: { token: resumo(token) },
    });
    if (
      !registro ||
      registro.tipo !== 'RECUPERACAO_SENHA' ||
      !tokenUtilizavel(registro, new Date())
    ) {
      throw Erros.linkExpirado();
    }
    const problema = problemaNaSenha(novaSenha);
    if (problema) throw Erros.dadosInvalidos('novaSenha', problema);

    // A senha atual entra na conta mesmo sem histórico gravado.
    const [atual, historico] = await Promise.all([
      this.prisma.usuario.findUniqueOrThrow({
        where: { id: registro.usuarioId },
        select: { senhaHash: true },
      }),
      this.prisma.historicoSenha.findMany({
        where: { usuarioId: registro.usuarioId },
        orderBy: { criadaEm: 'desc' },
        take: SENHAS_ANTERIORES_BLOQUEADAS,
        select: { senhaHash: true },
      }),
    ]);
    const anteriores = [
      ...(atual.senhaHash ? [{ senhaHash: atual.senhaHash }] : []),
      ...historico,
    ];
    for (const anterior of anteriores) {
      if (await verify(anterior.senhaHash, novaSenha).catch(() => false)) {
        throw Erros.dadosInvalidos(
          'novaSenha',
          'Use uma senha diferente das três últimas (RN06).',
        );
      }
    }

    const senhaHash = await hash(novaSenha);
    const sessoes = await this.prisma.sessao.findMany({
      where: { usuarioId: registro.usuarioId },
      select: { id: true },
    });
    const agora = new Date();
    await this.prisma.$transaction([
      this.prisma.tokenAcesso.update({
        where: { id: registro.id },
        data: { utilizado: true },
      }),
      this.prisma.usuario.update({
        where: { id: registro.usuarioId },
        data: {
          senhaHash,
          tentativasLoginFalhas: 0,
          bloqueadoAte: null,
          historicoSenha: { create: { senhaHash, criadaEm: agora } },
        },
      }),
      this.prisma.sessao.deleteMany({
        where: { usuarioId: registro.usuarioId },
      }),
    ]);
    const segundos =
      this.config.get('JWT_EXPIRACAO_MINUTOS', { infer: true }) * 60;
    await Promise.all(
      sessoes.map((s) => this.revogadas.revogar(s.id, segundos)),
    );
    await this.auditoria.registrar({
      acao: 'SENHA_REDEFINIDA',
      entidade: 'Usuario',
      entidadeId: registro.usuarioId,
      nivel: 'ALERTA',
      autorId: registro.usuarioId,
    });
  }
}
