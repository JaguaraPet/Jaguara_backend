import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Armazenamento } from '../../../compartilhado/arquivos/armazenamento';
import { garantirMesmaEmpresa } from '../../../compartilhado/auth/escopo-empresa';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Ambiente } from '../../../compartilhado/config/ambiente';
import {
  Cifragem,
  cpfValido,
  mascararCpf,
  normalizarCpf,
} from '../../../compartilhado/cripto/cifragem';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { FilaEmailService } from '../../notificacao/aplicacao/fila-email.service';
import {
  dataDaPlanilha,
  especieDaPlanilha,
  MAXIMO_LINHAS_IMPORTACAO,
  normalizarTexto,
  problemaNaLinha,
  sexoDaPlanilha,
  type LinhaImportacao,
} from '../dominio/importacao-clientes';
import { RACA_OUTRA } from '../../pet/dominio/catalogo-especies';
import {
  nomeDaChave,
  nomeSeguro,
  problemaNoArquivo,
} from '../../saude/dominio/documento';
import {
  codigoCliente,
  DIAS_PRE_CADASTRO,
  preCadastroVencido,
  situacaoConsentimento,
  SituacaoConsentimento,
} from '../dominio/regras-cliente';

export interface NovoCliente {
  nome: string;
  cpf?: string;
  telefone?: string;
  email?: string;
  observacoes?: string;
  meioConsentimento: 'ASSINATURA_PRESENCIAL' | 'LINK_DIGITAL';
  evidenciaArquivoUrl?: string;
  /** Cópia do termo assinado enviada pelo sistema (PDF ou foto). */
  evidenciaArquivo?: { nomeArquivo: string; tamanhoBytes: number };
}

export interface ArquivoTermo {
  nomeArquivo: string;
  tamanhoBytes: number;
}

export interface ClienteResposta {
  id: string;
  codigo: string;
  nome: string;
  cpf?: string;
  telefone?: string;
  email?: string;
  possuiConta: boolean;
  ativo: boolean;
  consentimento: SituacaoConsentimento;
  /** O termo assinado está anexado. */
  possuiTermoAnexado: boolean;
  linkTermo?: string;
  /** URL para enviar a cópia do termo com PUT, válida por 5 minutos. */
  urlEnvioTermo?: string;
}

export interface PetEntrada {
  nome: string;
  racaId: string;
  dataNascimento?: string;
  sexo: 'MACHO' | 'FEMEA';
  pesoKg?: number;
  cor?: string;
  microchip?: string;
  castrado: boolean;
}

type Tx = Pick<PrismaService, 'cliente' | 'clientePet' | 'responsavelPet'>;

const incluirConsentimento = {
  consentimento: { orderBy: { criadoEm: 'desc' as const }, take: 1 },
} as const;

/**
 * Clientes da empresa, com ou sem conta no Jaguara (UC-21, ADR-010 item 3). Dados além de
 * nome e contato, pets e agendamentos só depois do consentimento no termo vigente (RN41).
 */
@Injectable()
export class ClientesService {
  private readonly logger = new Logger(ClientesService.name);
  private readonly cifragem: Cifragem;

  constructor(
    private readonly prisma: PrismaService,
    private readonly fila: FilaEmailService,
    private readonly config: ConfigService<Ambiente, true>,
    private readonly armazenamento?: Armazenamento,
  ) {
    this.cifragem = new Cifragem(
      config.get('CHAVE_CRIPTOGRAFIA', { infer: true }),
    );
  }

  async listar(
    usuario: UsuarioAutenticado,
    empresaId: string,
  ): Promise<ClienteResposta[]> {
    garantirMesmaEmpresa(usuario, empresaId);
    const clientes = await this.prisma.cliente.findMany({
      where: { empresaId },
      include: incluirConsentimento,
      orderBy: { nome: 'asc' },
    });
    return clientes.map((c) => this.resposta(c));
  }

  async cadastrar(
    usuario: UsuarioAutenticado,
    empresaId: string,
    dados: NovoCliente,
    ip: string,
  ): Promise<ClienteResposta> {
    garantirMesmaEmpresa(usuario, empresaId);
    const presencial = dados.meioConsentimento === 'ASSINATURA_PRESENCIAL';
    if (presencial && !dados.evidenciaArquivoUrl && !dados.evidenciaArquivo) {
      throw Erros.dadosInvalidos(
        'evidenciaArquivo',
        'Anexe a cópia do termo assinado (RN41).',
      );
    }
    const chaveTermo = dados.evidenciaArquivo
      ? this.chaveDoTermo(empresaId, dados.evidenciaArquivo)
      : undefined;
    if (!presencial && !dados.email) {
      throw Erros.dadosInvalidos(
        'email',
        'Informe o e-mail do cliente para enviar o link do termo.',
      );
    }
    const cpf = dados.cpf ? normalizarCpf(dados.cpf) : undefined;
    if (cpf && !cpfValido(cpf))
      throw Erros.dadosInvalidos('cpf', 'CPF inválido. Confira os números.');
    const email = dados.email?.trim().toLowerCase();
    const cpfHash = cpf ? this.cifragem.indiceCego(cpf) : undefined;

    const termo = await this.prisma.termoUso.findFirst({
      where: {
        tipo: 'CONSENTIMENTO_CLIENTE',
        dataVigencia: { lte: new Date() },
      },
      orderBy: { dataVigencia: 'desc' },
    });
    if (!termo)
      throw Erros.conflito(
        'TERMOS_INDISPONIVEIS',
        'O termo de consentimento ainda não foi publicado.',
      );

    // Liga à conta do tutor quando o e-mail ou o CPF já existem (ADR-010).
    const tutor = await this.prisma.tutor.findFirst({
      where: {
        OR: [
          ...(email ? [{ usuario: { email } }] : []),
          ...(cpfHash ? [{ cpfHash }] : []),
        ],
      },
      select: { id: true },
    });
    if (tutor) {
      const jaCliente = await this.prisma.cliente.findFirst({
        where: { empresaId, tutorId: tutor.id },
        select: { id: true },
      });
      if (jaCliente)
        throw Erros.conflito(
          'RN25_CLIENTE_EXISTENTE',
          'Esta pessoa já é cliente da empresa.',
        );
    }
    if (
      cpfHash &&
      (await this.prisma.cliente.findFirst({ where: { empresaId, cpfHash } }))
    ) {
      throw Erros.conflito(
        'RN25_CLIENTE_EXISTENTE',
        'Já existe um cliente com este CPF na empresa.',
      );
    }

    const token = randomBytes(32).toString('base64url');
    const agora = new Date();
    const sequencia =
      (await this.prisma.cliente.count({ where: { empresaId } })) + 1;
    const cliente = await this.prisma.cliente.create({
      data: {
        empresaId,
        tutorId: tutor?.id,
        codigo: codigoCliente(sequencia),
        nome: dados.nome.trim(),
        telefone: dados.telefone,
        email,
        // Pré-cadastro por link guarda só nome e contato até o aceite (RN41).
        ...(presencial && cpf
          ? { cpfCifrado: this.cifragem.cifrar(cpf), cpfHash }
          : {}),
        observacoes: presencial ? dados.observacoes : null,
        dataVinculo: agora,
        ativo: true,
        consentimento: {
          create: {
            termoId: termo.id,
            meioColeta: dados.meioConsentimento,
            aceito: presencial,
            dataAceite: agora,
            evidenciaUrl: chaveTermo ?? dados.evidenciaArquivoUrl,
            ipOrigem: ip.slice(0, 255),
            tokenLink: this.hash(token),
            registradoPorId:
              usuario.tipo === 'FUNCIONARIO' ? usuario.sub : undefined,
          },
        },
      },
      include: incluirConsentimento,
    });

    const empresa = await this.nomeEmpresa(empresaId);
    if (!presencial && email) {
      await this.fila.enviar('TERMO_CLIENTE', email, {
        nome: cliente.nome,
        empresa,
        link: this.link(token),
        validadeDias: DIAS_PRE_CADASTRO,
      });
    }
    return {
      ...this.resposta(cliente),
      ...(presencial ? {} : { linkTermo: this.link(token) }),
      ...(chaveTermo && this.armazenamento
        ? { urlEnvioTermo: this.armazenamento.urlEnvio(chaveTermo) }
        : {}),
    };
  }

  /** Pet de cliente sem conta (ADR-010): só com consentimento vigente (RN41, CT-21-02). */
  async cadastrarPet(
    usuario: UsuarioAutenticado,
    empresaId: string,
    clienteId: string,
    dados: PetEntrada,
  ) {
    garantirMesmaEmpresa(usuario, empresaId);
    const cliente = await this.prisma.cliente.findFirst({
      where: { id: clienteId, empresaId },
      include: incluirConsentimento,
    });
    if (!cliente || !cliente.ativo)
      throw Erros.naoEncontrado('Cliente não encontrado');
    if (situacaoConsentimento(cliente.consentimento[0]) !== 'VIGENTE') {
      throw Erros.conflito(
        'RN41_SEM_CONSENTIMENTO',
        'O cliente ainda não aceitou o termo de consentimento.',
      );
    }
    if (cliente.tutorId) {
      throw Erros.conflito(
        'CLIENTE_COM_CONTA',
        'O cliente tem conta no Jaguara: os pets são cadastrados por ele no app.',
      );
    }
    const raca = await this.prisma.raca.findUnique({
      where: { id: dados.racaId },
      include: { especie: true },
    });
    if (!raca) throw Erros.dadosInvalidos('racaId', 'Escolha uma raça válida.');

    const pet = await this.prisma.pet.create({
      data: {
        nome: dados.nome.trim(),
        racaId: dados.racaId,
        dataNascimento: dados.dataNascimento
          ? new Date(`${dados.dataNascimento}T00:00:00Z`)
          : null,
        sexo: dados.sexo,
        pesoKg: dados.pesoKg,
        cor: dados.cor,
        microchip: dados.microchip,
        castrado: dados.castrado,
        status: 'ATIVO',
        clientePet: { create: { clienteId } },
      },
    });
    return {
      id: pet.id,
      nome: pet.nome,
      racaId: pet.racaId,
      raca: raca.nome,
      especie: raca.especie.nome,
      sexo: pet.sexo,
      castrado: pet.castrado,
      dataNascimento: dados.dataNascimento,
      pesoKg: dados.pesoKg,
      cor: pet.cor ?? undefined,
      microchip: pet.microchip ?? undefined,
      status: pet.status,
    };
  }

  /** Revogação pedida pelo cliente à empresa (RN41). */
  async revogarPelaEmpresa(
    usuario: UsuarioAutenticado,
    empresaId: string,
    clienteId: string,
  ) {
    garantirMesmaEmpresa(usuario, empresaId);
    const cliente = await this.prisma.cliente.findFirst({
      where: { id: clienteId, empresaId },
      include: incluirConsentimento,
    });
    if (!cliente) throw Erros.naoEncontrado('Cliente não encontrado');
    await this.revogar(cliente.id, cliente.consentimento[0]?.id);
  }

  /** Página pública do termo (UC-21, UX-01 seção 4.1). */
  async abrirTermo(token: string) {
    const consentimento = await this.consentimentoDoLink(token);
    const situacao = situacaoConsentimento(consentimento);
    if (
      situacao === 'PENDENTE' &&
      preCadastroVencido(consentimento.criadoEm, new Date())
    ) {
      throw Erros.linkExpirado();
    }
    const t = consentimento.termo;
    return {
      empresa: consentimento.cliente!.empresa.nomeFantasia,
      termo: {
        id: t.id,
        tipo: t.tipo,
        versao: t.versao,
        titulo: t.titulo,
        conteudo: t.conteudo,
        dataVigencia: t.dataVigencia.toISOString().slice(0, 10),
        obrigatorio: t.obrigatorio,
      },
      situacao,
    };
  }

  /** "Concordo" no link: registra data, hora, IP e versão e manda o comprovante (CT-21-04). */
  async aceitar(token: string, ip: string): Promise<void> {
    const consentimento = await this.consentimentoDoLink(token);
    const situacao = situacaoConsentimento(consentimento);
    if (situacao === 'VIGENTE') return;
    if (
      situacao === 'REVOGADO' ||
      preCadastroVencido(consentimento.criadoEm, new Date())
    ) {
      throw Erros.linkExpirado();
    }
    const agora = new Date();
    await this.prisma.consentimento.update({
      where: { id: consentimento.id },
      data: { aceito: true, dataAceite: agora, ipOrigem: ip.slice(0, 255) },
    });
    const cliente = consentimento.cliente!;
    if (cliente.email) {
      await this.fila.enviar('COMPROVANTE_CONSENTIMENTO', cliente.email, {
        nome: cliente.nome,
        empresa: cliente.empresa.nomeFantasia,
        versao: consentimento.termo.versao,
        dataHora: agora.toLocaleString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
        }),
        link: this.link(token),
      });
    }
  }

  /** Revogação pelo link do comprovante, sem conta (CT-21-06). */
  async revogarPeloLink(token: string): Promise<void> {
    const consentimento = await this.consentimentoDoLink(token);
    if (situacaoConsentimento(consentimento) === 'REVOGADO') return;
    await this.revogar(consentimento.clienteId!, consentimento.id);
    this.logger.log(
      `Consentimento revogado pelo cliente da empresa ${consentimento.cliente!.empresaId}`,
    );
  }

  /**
   * RC-33: o tutor que cria a conta com o e-mail ou o CPF de um cliente sem conta passa a ser
   * dono do cadastro e responsável principal dos pets dele (CT-21-03).
   */
  async vincularTutor(
    tx: Tx,
    tutorId: string,
    email: string,
    cpfHash: string,
  ): Promise<void> {
    const clientes = await tx.cliente.findMany({
      where: { tutorId: null, ativo: true, OR: [{ email }, { cpfHash }] },
      include: { clientePet: true },
    });
    const empresas = new Set<string>();
    for (const cliente of clientes) {
      if (empresas.has(cliente.empresaId)) continue;
      empresas.add(cliente.empresaId);
      await tx.cliente.update({ where: { id: cliente.id }, data: { tutorId } });
      for (const { petId } of cliente.clientePet) {
        const principal = await tx.responsavelPet.findFirst({
          where: { petId, tipo: 'PRINCIPAL' },
        });
        if (principal) continue;
        await tx.responsavelPet.create({
          data: {
            petId,
            tutorId,
            tipo: 'PRINCIPAL',
            ativo: true,
            dataVinculo: new Date(),
          },
        });
      }
    }
  }

  /** Rotina diária: exclui pré-cadastros sem aceite há mais de 7 dias (RN41, CT-21-05). */
  async limparPreCadastros(agora = new Date()): Promise<number> {
    const limite = new Date(agora.getTime() - DIAS_PRE_CADASTRO * 86_400_000);
    const vencidos = await this.prisma.cliente.findMany({
      where: {
        ativo: true,
        criadoEm: { lt: limite },
        consentimento: { every: { aceito: false, dataRevogacao: null } },
      },
      select: { id: true, empresaId: true },
    });
    for (const cliente of vencidos) {
      await this.prisma.$transaction([
        this.prisma.consentimento.deleteMany({
          where: { clienteId: cliente.id },
        }),
        this.prisma.cliente.delete({ where: { id: cliente.id } }),
      ]);
      this.logger.log(
        `Pré-cadastro vencido excluído da empresa ${cliente.empresaId}`,
      );
    }
    return vencidos.length;
  }

  private async revogar(clienteId: string, consentimentoId?: string) {
    const agora = new Date();
    await this.prisma.$transaction([
      ...(consentimentoId
        ? [
            this.prisma.consentimento.update({
              where: { id: consentimentoId },
              data: { aceito: false, dataRevogacao: agora },
            }),
          ]
        : []),
      // Cliente inativado e dados anonimizados, exceto o exigido por lei (RN41, ARQ-02).
      this.prisma.cliente.update({
        where: { id: clienteId },
        data: {
          ativo: false,
          nome: 'Cliente removido',
          cpfCifrado: null,
          cpfHash: null,
          telefone: null,
          email: null,
          observacoes: null,
          tutorId: null,
        },
      }),
    ]);
  }

  private async consentimentoDoLink(token: string) {
    const consentimento = await this.prisma.consentimento.findUnique({
      where: { tokenLink: this.hash(token) },
      include: {
        termo: true,
        cliente: { include: { empresa: { select: { nomeFantasia: true } } } },
      },
    });
    if (!consentimento?.cliente)
      throw Erros.naoEncontrado('Link não encontrado');
    return consentimento;
  }

  private async nomeEmpresa(empresaId: string) {
    const empresa = await this.prisma.empresaEnterprise.findUniqueOrThrow({
      where: { id: empresaId },
      select: { nomeFantasia: true },
    });
    return empresa.nomeFantasia;
  }

  private link(token: string) {
    const url = this.config.get('URL_WEB', { infer: true }).split(',')[0];
    return `${url}/termo/${token}`;
  }

  private hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Importa clientes de uma planilha: cada linha vira cliente com consentimento registrado pela
   * declaração da empresa (os clientes já autorizaram o uso dos dados), e o pet da linha,
   * quando houver. Linhas repetidas ou inválidas são ignoradas com o motivo.
   */
  async importar(
    usuario: UsuarioAutenticado,
    empresaId: string,
    dados: { declaracaoConsentimento: boolean; linhas: LinhaImportacao[] },
    ip: string,
  ) {
    garantirMesmaEmpresa(usuario, empresaId);
    if (!dados.declaracaoConsentimento) {
      throw Erros.dadosInvalidos(
        'declaracaoConsentimento',
        'Confirme que os clientes autorizaram o uso dos dados.',
      );
    }
    if (
      dados.linhas.length === 0 ||
      dados.linhas.length > MAXIMO_LINHAS_IMPORTACAO
    ) {
      throw Erros.dadosInvalidos(
        'linhas',
        `Envie de 1 a ${MAXIMO_LINHAS_IMPORTACAO} clientes por vez.`,
      );
    }
    const termo = await this.prisma.termoUso.findFirst({
      where: {
        tipo: 'CONSENTIMENTO_CLIENTE',
        dataVigencia: { lte: new Date() },
      },
      orderBy: { dataVigencia: 'desc' },
    });
    if (!termo)
      throw Erros.conflito(
        'TERMO_INDISPONIVEL',
        'Não há termo de consentimento vigente.',
      );
    const [existentes, especies] = await Promise.all([
      this.prisma.cliente.findMany({
        where: { empresaId },
        select: { cpfHash: true, email: true, nome: true, telefone: true },
      }),
      this.prisma.especie.findMany({ include: { raca: true } }),
    ]);
    const chave = (nome: string, telefone?: string | null) =>
      `${normalizarTexto(nome)}|${(telefone ?? '').replace(/\D/g, '')}`;
    const cpfs = new Set(existentes.map((c) => c.cpfHash).filter(Boolean));
    const emails = new Set(existentes.map((c) => c.email).filter(Boolean));
    const nomes = new Set(existentes.map((c) => chave(c.nome, c.telefone)));
    let sequencia = await this.prisma.cliente.count({ where: { empresaId } });
    const agora = new Date();
    const ignorados: { linha: number; nome?: string; motivo: string }[] = [];
    let criados = 0;
    let petsCriados = 0;

    for (const [i, linha] of dados.linhas.entries()) {
      const numero = i + 2; // a linha 1 da planilha é o cabeçalho
      const nome = linha.nome?.trim();
      const motivo = problemaNaLinha(linha);
      if (motivo) {
        ignorados.push({ linha: numero, nome, motivo });
        continue;
      }
      const cpf = linha.cpf?.trim() ? normalizarCpf(linha.cpf) : undefined;
      if (cpf && !cpfValido(cpf)) {
        ignorados.push({ linha: numero, nome, motivo: 'CPF inválido.' });
        continue;
      }
      const cpfHash = cpf ? this.cifragem.indiceCego(cpf) : undefined;
      const email = linha.email?.trim().toLowerCase() || undefined;
      const telefone = linha.telefone?.trim() || undefined;
      if (
        (cpfHash && cpfs.has(cpfHash)) ||
        (email && emails.has(email)) ||
        nomes.has(chave(nome, telefone))
      ) {
        ignorados.push({
          linha: numero,
          nome,
          motivo: 'Já é cliente da empresa.',
        });
        continue;
      }
      const especie = linha.petNome?.trim()
        ? especieDaPlanilha(especies, linha.petEspecie!)
        : undefined;
      if (linha.petNome?.trim() && !especie) {
        ignorados.push({
          linha: numero,
          nome,
          motivo: `Espécie "${linha.petEspecie}" não reconhecida.`,
        });
        continue;
      }
      const raca = especie
        ? this.racaDaPlanilha(especie.raca, linha.petRaca)
        : undefined;
      const nascimento = linha.petNascimento?.trim()
        ? dataDaPlanilha(linha.petNascimento)
        : null;

      await this.prisma.cliente.create({
        data: {
          empresaId,
          codigo: codigoCliente(++sequencia),
          nome,
          telefone,
          email,
          ...(cpf ? { cpfCifrado: this.cifragem.cifrar(cpf), cpfHash } : {}),
          observacoes: linha.observacoes?.trim() || null,
          dataVinculo: agora,
          ativo: true,
          consentimento: {
            create: {
              termoId: termo.id,
              meioColeta: 'IMPORTACAO',
              aceito: true,
              dataAceite: agora,
              ipOrigem: ip.slice(0, 255),
              registradoPorId:
                usuario.tipo === 'FUNCIONARIO' ? usuario.sub : undefined,
            },
          },
          ...(raca
            ? {
                clientePet: {
                  create: {
                    pet: {
                      create: {
                        nome: linha.petNome!.trim(),
                        racaId: raca.id,
                        racaDescricao: raca.descricao,
                        sexo: sexoDaPlanilha(linha.petSexo),
                        dataNascimento: nascimento
                          ? new Date(`${nascimento}T00:00:00Z`)
                          : null,
                        castrado: false,
                        status: 'ATIVO',
                      },
                    },
                  },
                },
              }
            : {}),
        },
      });
      if (cpfHash) cpfs.add(cpfHash);
      if (email) emails.add(email);
      nomes.add(chave(nome, telefone));
      criados++;
      if (raca) petsCriados++;
    }
    return { criados, petsCriados, ignorados };
  }

  /** Raça pelo nome; sem raça, "Sem raça definida"; raça desconhecida vira "Outra" com o texto. */
  private racaDaPlanilha(
    racas: { id: string; nome: string }[],
    texto?: string,
  ): { id: string; descricao: string | null } | undefined {
    const t = texto?.trim();
    const achar = (n: string) =>
      racas.find((r) => normalizarTexto(r.nome) === normalizarTexto(n));
    if (t) {
      const exata = achar(t);
      if (exata) return { id: exata.id, descricao: null };
      const outra = achar(RACA_OUTRA);
      if (outra) return { id: outra.id, descricao: t.slice(0, 80) };
    }
    const srd = achar('Sem raça definida') ?? achar(RACA_OUTRA) ?? racas[0];
    return srd
      ? {
          id: srd.id,
          descricao: srd.nome === RACA_OUTRA ? 'Não informada' : null,
        }
      : undefined;
  }

  /** Anexa ou troca a cópia do termo assinado no consentimento presencial vigente. */
  async anexarTermo(
    usuario: UsuarioAutenticado,
    empresaId: string,
    clienteId: string,
    arquivo: ArquivoTermo,
  ): Promise<{ urlEnvio: string }> {
    garantirMesmaEmpresa(usuario, empresaId);
    const consentimento = await this.consentimentoAtual(empresaId, clienteId);
    if (
      consentimento.meioColeta !== 'ASSINATURA_PRESENCIAL' ||
      !consentimento.aceito ||
      consentimento.dataRevogacao
    ) {
      throw Erros.conflito(
        'TERMO_NAO_PRESENCIAL',
        'Só o termo assinado no balcão e vigente recebe a cópia anexada.',
      );
    }
    const chave = this.chaveDoTermo(empresaId, arquivo);
    await this.prisma.consentimento.update({
      where: { id: consentimento.id },
      data: { evidenciaUrl: chave },
    });
    return { urlEnvio: this.armazenamento!.urlEnvio(chave) };
  }

  /** Link para abrir a cópia do termo assinado. */
  async verTermo(
    usuario: UsuarioAutenticado,
    empresaId: string,
    clienteId: string,
  ): Promise<{ url: string }> {
    garantirMesmaEmpresa(usuario, empresaId);
    const { evidenciaUrl } = await this.consentimentoAtual(
      empresaId,
      clienteId,
    );
    if (!evidenciaUrl)
      throw Erros.naoEncontrado('Este cliente não tem termo anexado');
    // Cadastros antigos guardavam um link externo; os novos, a chave no armazenamento.
    if (/^https?:\/\//.test(evidenciaUrl)) return { url: evidenciaUrl };
    return {
      url: this.armazenamento!.urlDownload(
        evidenciaUrl,
        nomeDaChave(evidenciaUrl),
      ),
    };
  }

  private async consentimentoAtual(empresaId: string, clienteId: string) {
    const consentimento = await this.prisma.consentimento.findFirst({
      where: { clienteId, cliente: { empresaId } },
      orderBy: { criadoEm: 'desc' },
    });
    if (!consentimento) throw Erros.naoEncontrado('Cliente não encontrado');
    return consentimento;
  }

  private chaveDoTermo(empresaId: string, arquivo: ArquivoTermo): string {
    const problema = problemaNoArquivo(
      arquivo.nomeArquivo,
      arquivo.tamanhoBytes,
    );
    if (problema) throw Erros.dadosInvalidos('evidenciaArquivo', problema);
    return `empresas/${empresaId}/termos/${randomUUID()}/${nomeSeguro(arquivo.nomeArquivo)}`;
  }

  private resposta(c: {
    id: string;
    codigo: string;
    nome: string;
    cpfCifrado: Uint8Array | null;
    telefone: string | null;
    email: string | null;
    tutorId: string | null;
    ativo: boolean;
    consentimento: {
      aceito: boolean;
      dataRevogacao: Date | null;
      evidenciaUrl?: string | null;
    }[];
  }): ClienteResposta {
    return {
      id: c.id,
      codigo: c.codigo,
      nome: c.nome,
      cpf: c.cpfCifrado
        ? mascararCpf(this.cifragem.decifrar(c.cpfCifrado))
        : undefined,
      telefone: c.telefone ?? undefined,
      email: c.email ?? undefined,
      possuiConta: c.tutorId !== null,
      ativo: c.ativo,
      consentimento: situacaoConsentimento(c.consentimento[0]),
      possuiTermoAnexado: !!c.consentimento[0]?.evidenciaUrl,
    };
  }
}
