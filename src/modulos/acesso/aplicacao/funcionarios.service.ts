import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { garantirMesmaEmpresa } from '../../../compartilhado/auth/escopo-empresa';
import { SessoesRevogadas } from '../../../compartilhado/auth/sessoes-revogadas';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Ambiente } from '../../../compartilhado/config/ambiente';
import {
  Cifragem,
  cpfValido,
  normalizarCpf,
} from '../../../compartilhado/cripto/cifragem';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { FilaEmailService } from '../../notificacao/aplicacao/fila-email.service';
import {
  HORAS_VALIDADE_CONFIRMACAO,
  normalizarEmail,
} from '../dominio/regras-cadastro';

export interface Funcionario {
  id: string;
  nome: string;
  email: string;
  cargo: string | null;
  perfil: string;
  ativo: boolean;
}

export interface NovoFuncionario {
  nome: string;
  cpf: string;
  email: string;
  cargo?: string;
  perfilId: string;
}

const incluir = { usuario: { include: { perfil: true } } } as const;

/** Equipe da empresa (UC-19) e perfil de cada funcionário (UC-16). */
@Injectable()
export class FuncionariosService {
  private readonly cifragem: Cifragem;

  constructor(
    private readonly prisma: PrismaService,
    private readonly fila: FilaEmailService,
    private readonly revogadas: SessoesRevogadas,
    private readonly config: ConfigService<Ambiente, true>,
  ) {
    this.cifragem = new Cifragem(
      config.get('CHAVE_CRIPTOGRAFIA', { infer: true }),
    );
  }

  async listar(
    usuario: UsuarioAutenticado,
    empresaId: string,
  ): Promise<Funcionario[]> {
    garantirMesmaEmpresa(usuario, empresaId);
    const funcionarios = await this.prisma.funcionarioEnterprise.findMany({
      where: { empresaId },
      include: incluir,
      orderBy: { nome: 'asc' },
    });
    return funcionarios.map((f) => this.paraResposta(f));
  }

  /** Cadastra o funcionário e envia o convite; a conta fica pendente até ele criar a senha (RN02). */
  async cadastrar(
    usuario: UsuarioAutenticado,
    empresaId: string,
    dados: NovoFuncionario,
  ): Promise<Funcionario> {
    garantirMesmaEmpresa(usuario, empresaId);
    const email = normalizarEmail(dados.email);
    const cpf = normalizarCpf(dados.cpf);
    if (!cpfValido(cpf))
      throw Erros.dadosInvalidos('cpf', 'CPF inválido. Confira os números.');
    await this.garantirPerfilDaEmpresa(dados.perfilId, empresaId);
    if (
      await this.prisma.usuario.findUnique({
        where: { email },
        select: { id: true },
      })
    ) {
      throw Erros.conflito(
        'EMAIL_EM_USO',
        'Este e-mail já tem cadastro no Jaguara.',
      );
    }
    const cpfHash = this.cifragem.indiceCego(cpf);
    if (
      await this.prisma.funcionarioEnterprise.findUnique({
        where: { cpfHash },
        select: { id: true },
      })
    ) {
      throw Erros.conflito(
        'RN01_CPF_EM_USO',
        'Este CPF já está cadastrado como funcionário.',
      );
    }

    const token = randomBytes(32).toString('base64url');
    const agora = new Date();
    const empresa = await this.prisma.empresaEnterprise.findUniqueOrThrow({
      where: { id: empresaId },
      select: { nomeFantasia: true },
    });
    const criado = await this.prisma.$transaction(async (tx) => {
      const conta = await tx.usuario.create({
        data: {
          email,
          emailConfirmado: false,
          status: 'PENDENTE_CONFIRMACAO',
          tentativasLoginFalhas: 0,
          dataCadastro: agora,
          perfilId: dados.perfilId,
        },
      });
      await tx.tokenAcesso.create({
        data: {
          usuarioId: conta.id,
          token: createHash('sha256').update(token).digest('hex'),
          tipo: 'CONFIRMACAO_EMAIL',
          criadoEm: agora,
          expiraEm: new Date(
            agora.getTime() + HORAS_VALIDADE_CONFIRMACAO * 3_600_000,
          ),
          utilizado: false,
        },
      });
      return tx.funcionarioEnterprise.create({
        data: {
          id: conta.id,
          nome: dados.nome.trim(),
          cpfCifrado: this.cifragem.cifrar(cpf),
          cpfHash,
          cargo: dados.cargo?.trim() || null,
          ativo: true,
          empresaId,
        },
        include: incluir,
      });
    });

    const url = this.config.get('URL_WEB', { infer: true }).split(',')[0];
    await this.fila.enviar('CONVITE_FUNCIONARIO', email, {
      nome: dados.nome,
      empresa: empresa.nomeFantasia,
      link: `${url}/primeiro-acesso?token=${encodeURIComponent(token)}`,
      validadeHoras: HORAS_VALIDADE_CONFIRMACAO,
    });
    return this.paraResposta(criado);
  }

  /**
   * Troca o perfil de acesso (UC-16, RN20). As sessões abertas são encerradas para as
   * permissões novas valerem na hora.
   */
  async alterarPerfil(
    usuario: UsuarioAutenticado,
    funcionarioId: string,
    perfilId: string,
  ): Promise<Funcionario> {
    const funcionario = await this.buscar(usuario, funcionarioId);
    await this.garantirPerfilDaEmpresa(perfilId, funcionario.empresaId);
    await this.prisma.usuario.update({
      where: { id: funcionarioId },
      data: { perfilId },
    });
    await this.encerrarSessoes(funcionarioId);
    return this.paraResposta(
      await this.prisma.funcionarioEnterprise.findUniqueOrThrow({
        where: { id: funcionarioId },
        include: incluir,
      }),
    );
  }

  /** Desligamento: desativa a conta e revoga todos os acessos na hora (RN23). */
  async desligar(
    usuario: UsuarioAutenticado,
    funcionarioId: string,
  ): Promise<void> {
    await this.buscar(usuario, funcionarioId);
    await this.prisma.$transaction([
      this.prisma.funcionarioEnterprise.update({
        where: { id: funcionarioId },
        data: { ativo: false },
      }),
      this.prisma.usuario.update({
        where: { id: funcionarioId },
        data: { status: 'INATIVA' },
      }),
    ]);
    await this.encerrarSessoes(funcionarioId);
  }

  private async buscar(usuario: UsuarioAutenticado, funcionarioId: string) {
    const funcionario = await this.prisma.funcionarioEnterprise.findUnique({
      where: { id: funcionarioId },
    });
    if (!funcionario) throw Erros.naoEncontrado('Funcionário não encontrado');
    garantirMesmaEmpresa(usuario, funcionario.empresaId);
    return funcionario;
  }

  private async garantirPerfilDaEmpresa(perfilId: string, empresaId: string) {
    const perfil = await this.prisma.perfilAcesso.findUnique({
      where: { id: perfilId },
    });
    if (!perfil || perfil.empresaId !== empresaId) {
      throw Erros.dadosInvalidos(
        'perfilId',
        'Escolha um perfil de acesso da sua empresa.',
      );
    }
  }

  private async encerrarSessoes(usuarioId: string) {
    const sessoes = await this.prisma.sessao.findMany({
      where: { usuarioId },
      select: { id: true },
    });
    await this.prisma.sessao.deleteMany({ where: { usuarioId } });
    const segundos =
      this.config.get('JWT_EXPIRACAO_MINUTOS', { infer: true }) * 60;
    await Promise.all(
      sessoes.map((s) => this.revogadas.revogar(s.id, segundos)),
    );
  }

  private paraResposta(f: {
    id: string;
    nome: string;
    cargo: string | null;
    ativo: boolean;
    usuario: { email: string; perfil: { nome: string } };
  }): Funcionario {
    return {
      id: f.id,
      nome: f.nome,
      email: f.usuario.email,
      cargo: f.cargo,
      perfil: f.usuario.perfil.nome,
      ativo: f.ativo,
    };
  }
}
