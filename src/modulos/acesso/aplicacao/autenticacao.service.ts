import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import { SessoesRevogadas } from '../../../compartilhado/auth/sessoes-revogadas';
import { AuditoriaService } from '../../../compartilhado/auditoria/auditoria.service';
import {
  TipoUsuario,
  UsuarioAutenticado,
} from '../../../compartilhado/auth/usuario-autenticado';
import { Ambiente } from '../../../compartilhado/config/ambiente';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import {
  impedimentoDeLogin,
  registrarFalhaLogin,
  sessaoExpirada,
} from '../dominio/regras-login';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiraEm: string;
}

/** Hash usado quando o e-mail não existe, para o tempo de resposta não revelar contas. */
const HASH_FALSO = hash('senha-que-nao-existe');

const incluirAcesso = {
  perfil: {
    include: { perfilPermissao: { include: { permissao: true } } },
  },
  tutor: { select: { id: true } },
  empresaEnterprise: { select: { id: true } },
  funcionarioEnterprise: { select: { empresaId: true } },
  administrador: { select: { id: true } },
} as const;

/** Autenticação com senha, renovação e logout (UC-02, ADR-009, ADR-012). */
@Injectable()
export class AutenticacaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly revogadas: SessoesRevogadas,
    private readonly config: ConfigService<Ambiente, true>,
    private readonly auditoria: AuditoriaService,
  ) {}

  async login(
    email: string,
    senha: string,
    dispositivo?: string,
  ): Promise<Tokens> {
    const agora = new Date();
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!usuario?.senhaHash) {
      await verify(await HASH_FALSO, senha).catch(() => false);
      throw Erros.credenciaisInvalidas();
    }

    const impedimento = impedimentoDeLogin(usuario, agora);
    if (impedimento?.motivo === 'BLOQUEIO_TEMPORARIO') {
      throw Erros.contaBloqueada(impedimento.ate);
    }

    if (!(await verify(usuario.senhaHash, senha))) {
      const falha = registrarFalhaLogin(usuario, agora);
      await this.prisma.usuario.update({
        where: { id: usuario.id },
        data: falha,
      });
      if (falha.bloqueadoAte) {
        // Muitas falhas seguidas podem ser tentativa de invasão (RN03, RN31).
        await this.auditoria.registrar({
          acao: 'CONTA_BLOQUEADA',
          entidade: 'Usuario',
          entidadeId: usuario.id,
          nivel: 'ALERTA',
          autorId: usuario.id,
        });
        throw Erros.contaBloqueada(falha.bloqueadoAte);
      }
      throw Erros.credenciaisInvalidas();
    }

    if (impedimento?.motivo === 'EMAIL_NAO_CONFIRMADO')
      throw Erros.emailNaoConfirmado();
    if (impedimento?.motivo === 'CONTA_INDISPONIVEL')
      throw Erros.contaInativa();

    const refreshToken = this.novoRefreshToken();
    const [sessao] = await this.prisma.$transaction([
      this.prisma.sessao.create({
        data: {
          token: this.hashToken(refreshToken),
          inicio: agora,
          ultimaAtividade: agora,
          dispositivo: dispositivo?.slice(0, 255),
          usuarioId: usuario.id,
        },
      }),
      this.prisma.usuario.update({
        where: { id: usuario.id },
        data: { tentativasLoginFalhas: 0, bloqueadoAte: null },
      }),
    ]);
    return this.emitir(usuario.id, sessao.id, refreshToken);
  }

  /**
   * Abre a sessão de quem já provou a identidade de outro jeito (login social, UC-02 FA04):
   * mesmas regras de conta ativa do login com senha.
   */
  async abrirSessao(usuarioId: string, dispositivo?: string): Promise<Tokens> {
    const agora = new Date();
    const usuario = await this.prisma.usuario.findUniqueOrThrow({
      where: { id: usuarioId },
    });
    const impedimento = impedimentoDeLogin(usuario, agora);
    if (impedimento?.motivo === 'BLOQUEIO_TEMPORARIO') {
      throw Erros.contaBloqueada(impedimento.ate);
    }
    if (impedimento) throw Erros.contaInativa();
    const refreshToken = this.novoRefreshToken();
    const sessao = await this.prisma.sessao.create({
      data: {
        token: this.hashToken(refreshToken),
        inicio: agora,
        ultimaAtividade: agora,
        dispositivo: dispositivo?.slice(0, 255),
        usuarioId,
      },
    });
    return this.emitir(usuarioId, sessao.id, refreshToken);
  }

  /** Confere a senha sem contar tentativa (usada para ligar uma identidade externa à conta). */
  async senhaConfere(usuarioId: string, senha: string): Promise<boolean> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { senhaHash: true },
    });
    if (!usuario?.senhaHash) return false;
    return verify(usuario.senhaHash, senha).catch(() => false);
  }

  async renovar(refreshToken: string): Promise<Tokens> {
    const agora = new Date();
    const sessao = await this.prisma.sessao.findUnique({
      where: { token: this.hashToken(refreshToken) },
      include: { usuario: true },
    });
    if (!sessao) throw Erros.naoAutenticado('Refresh token inválido.');

    const horas = this.config.get('SESSAO_INATIVIDADE_HORAS', { infer: true });
    if (sessaoExpirada(sessao.ultimaAtividade, agora, horas)) {
      await this.prisma.sessao.delete({ where: { id: sessao.id } });
      throw Erros.sessaoExpirada();
    }
    if (sessao.usuario.status !== 'ATIVA') {
      await this.encerrar(sessao.id);
      throw Erros.contaInativa();
    }

    // Rotação: o refresh token antigo deixa de valer a cada renovação.
    const novo = this.novoRefreshToken();
    await this.prisma.sessao.update({
      where: { id: sessao.id },
      data: { token: this.hashToken(novo), ultimaAtividade: agora },
    });
    return this.emitir(sessao.usuarioId, sessao.id, novo);
  }

  /** Logout: apaga a sessão e revoga o access token na hora (ADR-012). */
  async encerrar(sessaoId: string): Promise<void> {
    await this.prisma.sessao.deleteMany({ where: { id: sessaoId } });
    await this.revogadas.revogar(
      sessaoId,
      this.config.get('JWT_EXPIRACAO_MINUTOS', { infer: true }) * 60,
    );
  }

  /** Lê perfil e permissões no banco e assina o access token. */
  private async emitir(
    usuarioId: string,
    sessaoId: string,
    refreshToken: string,
  ): Promise<Tokens> {
    const usuario = await this.prisma.usuario.findUniqueOrThrow({
      where: { id: usuarioId },
      include: incluirAcesso,
    });
    const tipo: TipoUsuario = usuario.administrador
      ? 'ADMINISTRADOR'
      : usuario.empresaEnterprise
        ? 'EMPRESA'
        : usuario.funcionarioEnterprise
          ? 'FUNCIONARIO'
          : 'TUTOR';
    const conteudo: UsuarioAutenticado = {
      sub: usuario.id,
      sid: sessaoId,
      tipo,
      perfil: usuario.perfil.nome,
      empresaId:
        usuario.empresaEnterprise?.id ??
        usuario.funcionarioEnterprise?.empresaId ??
        null,
      permissoes: usuario.perfil.perfilPermissao
        .map((p) => p.permissao.codigo)
        .sort(),
    };
    const minutos = this.config.get('JWT_EXPIRACAO_MINUTOS', { infer: true });
    return {
      accessToken: await this.jwt.signAsync({ ...conteudo }),
      refreshToken,
      expiraEm: new Date(Date.now() + minutos * 60_000).toISOString(),
    };
  }

  private novoRefreshToken(): string {
    return randomBytes(48).toString('base64url');
  }

  /** O banco guarda só o hash do refresh token. */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
