import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import { Ambiente } from '../../../compartilhado/config/ambiente';
import {
  Cifragem,
  cpfValido,
  normalizarCpf,
} from '../../../compartilhado/cripto/cifragem';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { ClientesService } from '../../atendimento/aplicacao/clientes.service';
import { FilaEmailService } from '../../notificacao/aplicacao/fila-email.service';
import {
  cnpjValido,
  HORAS_VALIDADE_CONFIRMACAO,
  normalizarEmail,
  problemaNaSenha,
  tokenUtilizavel,
} from '../dominio/regras-cadastro';
import {
  CatalogoAcessoService,
  PERFIL_EMPRESA,
} from './catalogo-acesso.service';

type TipoTermo =
  'TERMOS_USO_APP' | 'TERMOS_ENTERPRISE' | 'POLITICA_PRIVACIDADE';

export interface DadosTutor {
  nome: string;
  cpf: string;
  email: string;
  telefone?: string;
  senha: string;
}

export interface DadosEmpresa {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string;
  tipo:
    | 'CLINICA_VETERINARIA'
    | 'PET_SHOP'
    | 'HOTEL_PET'
    | 'CRECHE'
    | 'CASA_DE_CUIDADO';
  email: string;
  senha: string;
  endereco: {
    cep: string;
    logradouro: string;
    numero: string;
    complemento?: string;
    bairro: string;
    cidade: string;
    uf: string;
  };
}

export interface UsuarioCriado {
  id: string;
  email: string;
  status: 'PENDENTE_CONFIRMACAO';
  perfil: string;
}

/** Cadastro de tutor (UC-01) e de empresa (UC-32) com confirmação de e-mail (RN02) e aceite dos termos (RN42). */
@Injectable()
export class CadastroService {
  private readonly cifragem: Cifragem;

  constructor(
    private readonly prisma: PrismaService,
    private readonly fila: FilaEmailService,
    private readonly catalogo: CatalogoAcessoService,
    private readonly config: ConfigService<Ambiente, true>,
    private readonly clientes: ClientesService,
  ) {
    this.cifragem = new Cifragem(
      config.get('CHAVE_CRIPTOGRAFIA', { infer: true }),
    );
  }

  async cadastrarTutor(dados: DadosTutor, ip: string): Promise<UsuarioCriado> {
    const email = normalizarEmail(dados.email);
    const cpf = normalizarCpf(dados.cpf);
    if (!cpfValido(cpf))
      throw Erros.dadosInvalidos('cpf', 'CPF inválido. Confira os números.');
    this.validarSenha(dados.senha);
    await this.garantirEmailLivre(email);
    const cpfHash = this.cifragem.indiceCego(cpf);
    if (
      await this.prisma.tutor.findUnique({
        where: { cpfHash },
        select: { id: true },
      })
    ) {
      throw Erros.conflito(
        'RN01_CPF_EM_USO',
        'Este CPF já tem cadastro no Jaguara.',
      );
    }
    const termos = await this.termosVigentes([
      'TERMOS_USO_APP',
      'POLITICA_PRIVACIDADE',
    ]);
    const senhaHash = await hash(dados.senha);
    const token = this.novoToken();

    const usuario = await this.prisma.$transaction(async (tx) => {
      const perfil = await tx.perfilAcesso.findFirstOrThrow({
        where: { nome: 'Tutor', escopo: 'GLOBAL', empresaId: null },
      });
      const criado = await this.criarUsuario(
        tx,
        email,
        senhaHash,
        perfil.id,
        dados.telefone,
      );
      await tx.tutor.create({
        data: {
          id: criado.id,
          nome: dados.nome.trim(),
          cpfCifrado: this.cifragem.cifrar(cpf),
          cpfHash,
        },
      });
      await this.registrarAceites(tx, criado.id, termos, ip);
      await this.registrarToken(tx, criado.id, token);
      return criado;
    });

    await this.enviarConfirmacao(email, dados.nome, token);
    return {
      id: usuario.id,
      email,
      status: 'PENDENTE_CONFIRMACAO',
      perfil: 'Tutor',
    };
  }

  async cadastrarEmpresa(
    dados: DadosEmpresa,
    ip: string,
  ): Promise<UsuarioCriado> {
    const email = normalizarEmail(dados.email);
    const cnpj = dados.cnpj.replace(/\D/g, '');
    if (!cnpjValido(cnpj))
      throw Erros.dadosInvalidos('cnpj', 'CNPJ inválido. Confira os números.');
    this.validarSenha(dados.senha);
    await this.garantirEmailLivre(email);
    if (
      await this.prisma.empresaEnterprise.findUnique({
        where: { cnpj },
        select: { id: true },
      })
    ) {
      throw Erros.conflito(
        'RN01_CNPJ_EM_USO',
        'Este CNPJ já tem cadastro no Jaguara.',
      );
    }
    const termos = await this.termosVigentes([
      'TERMOS_ENTERPRISE',
      'POLITICA_PRIVACIDADE',
    ]);
    const senhaHash = await hash(dados.senha);
    const token = this.novoToken();
    const e = dados.endereco;

    const usuario = await this.prisma.$transaction(async (tx) => {
      const perfil = await tx.perfilAcesso.findFirstOrThrow({
        where: { nome: PERFIL_EMPRESA.nome, escopo: 'GLOBAL', empresaId: null },
      });
      const criado = await this.criarUsuario(tx, email, senhaHash, perfil.id);
      await tx.empresaEnterprise.create({
        data: {
          id: criado.id,
          cnpj,
          razaoSocial: dados.razaoSocial.trim(),
          nomeFantasia: dados.nomeFantasia.trim(),
          tipo: dados.tipo,
          enderecoCep: e.cep,
          enderecoLogradouro: e.logradouro,
          enderecoNumero: e.numero,
          enderecoComplemento: e.complemento,
          enderecoBairro: e.bairro,
          enderecoCidade: e.cidade,
          enderecoUf: e.uf,
        },
      });
      await this.catalogo.criarPerfisDaEmpresa(criado.id, tx);
      await this.registrarAceites(tx, criado.id, termos, ip);
      await this.registrarToken(tx, criado.id, token);
      return criado;
    });

    await this.enviarConfirmacao(email, dados.nomeFantasia, token);
    return {
      id: usuario.id,
      email,
      status: 'PENDENTE_CONFIRMACAO',
      perfil: PERFIL_EMPRESA.nome,
    };
  }

  /**
   * RN02: o link ativa a conta uma única vez, dentro de 24 horas. Funcionário convidado (UC-19)
   * ainda não tem senha e a cria neste passo.
   */
  async confirmarEmail(token: string, senha?: string): Promise<void> {
    const registro = await this.prisma.tokenAcesso.findUnique({
      where: { token: this.hashToken(token) },
    });
    if (
      !registro ||
      registro.tipo !== 'CONFIRMACAO_EMAIL' ||
      !tokenUtilizavel(registro, new Date())
    ) {
      throw Erros.linkExpirado();
    }
    const usuario = await this.prisma.usuario.findUniqueOrThrow({
      where: { id: registro.usuarioId },
      select: { senhaHash: true },
    });
    let senhaHash: string | undefined;
    if (!usuario.senhaHash) {
      if (!senha)
        throw Erros.dadosInvalidos(
          'senha',
          'Crie uma senha para o primeiro acesso.',
        );
      this.validarSenha(senha);
      senhaHash = await hash(senha);
    }
    const agora = new Date();
    await this.prisma.$transaction([
      this.prisma.tokenAcesso.update({
        where: { id: registro.id },
        data: { utilizado: true },
      }),
      this.prisma.usuario.update({
        where: { id: registro.usuarioId },
        data: {
          emailConfirmado: true,
          status: 'ATIVA',
          ...(senhaHash
            ? {
                senhaHash,
                historicoSenha: { create: { senhaHash, criadaEm: agora } },
              }
            : {}),
        },
      }),
    ]);

    // RC-33: com o e-mail confirmado, o tutor assume o cadastro e os pets de cliente sem conta
    // com o mesmo e-mail ou CPF (CT-21-03).
    const tutor = await this.prisma.tutor.findUnique({
      where: { id: registro.usuarioId },
      select: { id: true, cpfHash: true, usuario: { select: { email: true } } },
    });
    if (tutor) {
      await this.prisma.$transaction((tx) =>
        this.clientes.vincularTutor(
          tx,
          tutor.id,
          tutor.usuario.email,
          tutor.cpfHash,
        ),
      );
    }
  }

  private validarSenha(senha: string) {
    const problema = problemaNaSenha(senha);
    if (problema) throw Erros.dadosInvalidos('senha', problema);
  }

  private async garantirEmailLivre(email: string) {
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
  }

  /** Versão vigente de cada termo obrigatório (RN42). */
  private async termosVigentes(tipos: TipoTermo[]) {
    const hoje = new Date();
    const termos = [];
    for (const tipo of tipos) {
      const termo = await this.prisma.termoUso.findFirst({
        where: { tipo, dataVigencia: { lte: hoje } },
        orderBy: { dataVigencia: 'desc' },
        select: { id: true },
      });
      if (!termo)
        throw Erros.conflito(
          'TERMOS_INDISPONIVEIS',
          'Os termos vigentes ainda não foram publicados.',
        );
      termos.push(termo.id);
    }
    return termos;
  }

  private criarUsuario(
    tx: Pick<PrismaService, 'usuario' | 'historicoSenha'>,
    email: string,
    senhaHash: string,
    perfilId: string,
    telefone?: string,
  ) {
    const agora = new Date();
    return tx.usuario.create({
      data: {
        email,
        senhaHash,
        telefone,
        emailConfirmado: false,
        status: 'PENDENTE_CONFIRMACAO',
        tentativasLoginFalhas: 0,
        dataCadastro: agora,
        perfilId,
        historicoSenha: { create: { senhaHash, criadaEm: agora } },
      },
    });
  }

  private async registrarAceites(
    tx: Pick<PrismaService, 'consentimento'>,
    usuarioId: string,
    termos: string[],
    ip: string,
  ) {
    const agora = new Date();
    await tx.consentimento.createMany({
      data: termos.map((termoId) => ({
        usuarioId,
        termoId,
        aceito: true,
        dataAceite: agora,
        meioColeta: 'ACEITE_NO_APP' as const,
        ipOrigem: ip.slice(0, 255),
      })),
    });
  }

  private async registrarToken(
    tx: Pick<PrismaService, 'tokenAcesso'>,
    usuarioId: string,
    token: string,
  ) {
    const agora = new Date();
    await tx.tokenAcesso.create({
      data: {
        usuarioId,
        token: this.hashToken(token),
        tipo: 'CONFIRMACAO_EMAIL',
        criadoEm: agora,
        expiraEm: new Date(
          agora.getTime() + HORAS_VALIDADE_CONFIRMACAO * 3_600_000,
        ),
        utilizado: false,
      },
    });
  }

  private async enviarConfirmacao(email: string, nome: string, token: string) {
    const url = this.config.get('URL_WEB', { infer: true }).split(',')[0];
    await this.fila.enviar('CONFIRMACAO_CADASTRO', email, {
      nome,
      link: `${url}/confirmar-email?token=${encodeURIComponent(token)}`,
      validadeHoras: HORAS_VALIDADE_CONFIRMACAO,
    });
  }

  private novoToken() {
    return randomBytes(32).toString('base64url');
  }

  /** O banco guarda só o hash do token do link. */
  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
