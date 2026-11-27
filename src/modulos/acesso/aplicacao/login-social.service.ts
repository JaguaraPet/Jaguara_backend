import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditoriaService } from '../../../compartilhado/auditoria/auditoria.service';
import { Ambiente } from '../../../compartilhado/config/ambiente';
import { ErroNegocio, Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { conferirClaims, listaDeIds } from '../dominio/identidade-social';
import type {
  IdentidadeSocial,
  ProvedorSocial,
} from '../dominio/identidade-social';
import { VerificadorIdentidade } from '../infra/verificador-identidade';
import { AutenticacaoService, Tokens } from './autenticacao.service';
import { CadastroService } from './cadastro.service';

/** Primeiro acesso: a API devolve 428 com o token para concluir o cadastro. */
export interface CadastroPendente {
  cadastroToken: string;
  nome?: string;
  email: string;
}

export type ResultadoLoginSocial =
  | { tipo: 'sessao'; tokens: Tokens }
  | { tipo: 'cadastro'; pendente: CadastroPendente };

const PUBLICO_CADASTRO = 'jaguara:cadastro-social';
const VALIDADE_CADASTRO = '30m';

/** Login com Google ou Apple (UC-02 FA04, UC-01, RF46, CT-02-03, CT-02-04). */
@Injectable()
export class LoginSocialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Ambiente, true>,
    private readonly verificador: VerificadorIdentidade,
    private readonly autenticacao: AutenticacaoService,
    private readonly cadastro: CadastroService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** IDs de cliente aceitos no id_token de cada provedor. */
  private audiencias(provedor: ProvedorSocial): string[] {
    return provedor === 'GOOGLE'
      ? listaDeIds(this.config.get('GOOGLE_LOGIN_CLIENT_IDS', { infer: true }))
      : listaDeIds(this.config.get('APPLE_CLIENT_ID', { infer: true }));
  }

  async entrar(
    dados: {
      provedor: ProvedorSocial;
      idToken: string;
      nonce: string;
      senha?: string;
    },
    dispositivo?: string,
  ): Promise<ResultadoLoginSocial> {
    const identidade = await this.identificar(
      dados.provedor,
      dados.idToken,
      dados.nonce,
    );

    // CT-02-03: identidade já ligada abre a sessão da conta dela.
    const ligada = await this.prisma.identidadeExterna.findUnique({
      where: {
        provedor_idExterno: {
          provedor: identidade.provedor,
          idExterno: identidade.idExterno,
        },
      },
    });
    if (ligada) {
      return {
        tipo: 'sessao',
        tokens: await this.autenticacao.abrirSessao(
          ligada.usuarioId,
          dispositivo,
        ),
      };
    }

    // CT-02-04: conta com o mesmo e-mail só liga a identidade depois da senha dela (RN01).
    const conta = await this.prisma.usuario.findUnique({
      where: { email: identidade.email },
      select: { id: true },
    });
    if (conta) {
      if (
        !dados.senha ||
        !(await this.autenticacao.senhaConfere(conta.id, dados.senha))
      ) {
        throw new ErroNegocio(
          HttpStatus.CONFLICT,
          dados.senha ? 'SENHA_INCORRETA_VINCULO' : 'IDENTIDADE_SEM_VINCULO',
          dados.senha
            ? 'Senha incorreta'
            : 'Este e-mail já tem conta no Jaguara',
          dados.senha
            ? 'Confira a senha da sua conta do Jaguara.'
            : `Confirme a senha da conta para ligar o login com ${nomeDoProvedor(identidade.provedor)}.`,
        );
      }
      await this.prisma.identidadeExterna.create({
        data: {
          provedor: identidade.provedor,
          idExterno: identidade.idExterno,
          emailProvedor: identidade.email,
          dataVinculo: new Date(),
          usuarioId: conta.id,
        },
      });
      await this.auditoria.registrar({
        acao: 'IDENTIDADE_EXTERNA_VINCULADA',
        entidade: 'Usuario',
        entidadeId: conta.id,
        nivel: 'INFO',
        autorId: conta.id,
        detalhes: identidade.provedor,
      });
      return {
        tipo: 'sessao',
        tokens: await this.autenticacao.abrirSessao(conta.id, dispositivo),
      };
    }

    // Primeiro acesso: o cadastro termina com CPF e aceite dos termos (UC-01).
    const cadastroToken = await this.jwt.signAsync(
      {
        provedor: identidade.provedor,
        sub: identidade.idExterno,
        email: identidade.email,
        nome: identidade.nome,
      },
      { audience: PUBLICO_CADASTRO, expiresIn: VALIDADE_CADASTRO },
    );
    return {
      tipo: 'cadastro',
      pendente: {
        cadastroToken,
        nome: identidade.nome,
        email: identidade.email,
      },
    };
  }

  async concluirCadastro(
    dados: {
      cadastroToken: string;
      nome: string;
      cpf: string;
      telefone?: string;
    },
    ip: string,
    dispositivo?: string,
  ): Promise<Tokens> {
    let pendente: { provedor: ProvedorSocial; sub: string; email: string };
    try {
      pendente = await this.jwt.verifyAsync(dados.cadastroToken, {
        audience: PUBLICO_CADASTRO,
      });
    } catch {
      throw Erros.linkExpirado();
    }
    const usuarioId = await this.cadastro.cadastrarTutorSocial(
      {
        nome: dados.nome,
        cpf: dados.cpf,
        email: pendente.email,
        telefone: dados.telefone,
      },
      { provedor: pendente.provedor, idExterno: pendente.sub },
      ip,
    );
    return this.autenticacao.abrirSessao(usuarioId, dispositivo);
  }

  private async identificar(
    provedor: ProvedorSocial,
    idToken: string,
    nonce: string,
  ): Promise<IdentidadeSocial> {
    const audiencias = this.audiencias(provedor);
    if (audiencias.length === 0) {
      throw new ErroNegocio(
        HttpStatus.SERVICE_UNAVAILABLE,
        'LOGIN_SOCIAL_INDISPONIVEL',
        `Login com ${nomeDoProvedor(provedor)} indisponível`,
        'Entre com e-mail e senha.',
      );
    }
    const claims = await this.verificador.verificar(provedor, idToken);
    const resultado =
      claims &&
      conferirClaims(claims, {
        provedor,
        audiencias,
        nonce,
        agora: new Date(),
      });
    if (!resultado || 'recusa' in resultado) {
      throw Erros.naoAutenticado(
        `Não foi possível confirmar o login com ${nomeDoProvedor(provedor)}.`,
      );
    }
    return resultado;
  }
}

const nomeDoProvedor = (p: ProvedorSocial) =>
  p === 'GOOGLE' ? 'Google' : 'Apple';
