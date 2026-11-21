import { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { Cifragem } from '../../src/compartilhado/cripto/cifragem';
import { PrismaClient } from '../../src/generated/prisma/client';
import { CatalogoAcessoService } from '../../src/modulos/acesso/aplicacao/catalogo-acesso.service';

export const SENHA_TESTE = 'senhaForte1';

let sequencia = 0;
const proximo = () => (sequencia += 1);

/** CPF com dígitos válidos a partir de um número de sequência. */
export function cpfTeste(n = proximo()): string {
  const base = String(100000000 + n).slice(-9);
  const dig = (b: string) => {
    const s = [...b].reduce((t, d, i) => t + Number(d) * (b.length + 1 - i), 0);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dig(base);
  return `${base}${d1}${dig(base + d1)}`;
}

/** CNPJ com dígitos válidos a partir de um número de sequência. */
export function cnpjTeste(n = proximo()): string {
  const base = String(100000000000 + n).slice(-12);
  const dig = (b: string) => {
    const pesos =
      b.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = [...b].reduce((t, d, i) => t + Number(d) * pesos[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dig(base);
  return `${base}${d1}${dig(base + d1)}`;
}

async function conta(prisma: PrismaClient, email: string, perfilNome: string) {
  const perfil = await prisma.perfilAcesso.findFirstOrThrow({
    where: { nome: perfilNome, escopo: 'GLOBAL' },
  });
  return prisma.usuario.create({
    data: {
      email,
      senhaHash: await hash(SENHA_TESTE),
      emailConfirmado: true,
      status: 'ATIVA',
      tentativasLoginFalhas: 0,
      dataCadastro: new Date(),
      perfilId: perfil.id,
    },
  });
}

/** Empresa ativa com os perfis padrão. Use depois de subir a API (que sincroniza o catálogo). */
export async function criarEmpresa(
  app: INestApplication,
  prisma: PrismaClient,
  email: string,
  nomeFantasia = 'Clínica Teste',
): Promise<string> {
  const usuario = await conta(prisma, email, 'Empresa');
  await prisma.empresaEnterprise.create({
    data: {
      id: usuario.id,
      cnpj: cnpjTeste(),
      razaoSocial: `${nomeFantasia} Ltda.`,
      nomeFantasia,
      tipo: 'CLINICA_VETERINARIA',
      enderecoCep: '05400000',
      enderecoLogradouro: 'Rua A',
      enderecoNumero: '1',
      enderecoBairro: 'Centro',
      enderecoCidade: 'São Paulo',
      enderecoUf: 'SP',
    },
  });
  await app.get(CatalogoAcessoService).criarPerfisDaEmpresa(usuario.id);
  return usuario.id;
}

/** Tutor ativo com CPF cifrado. */
export async function criarTutor(
  prisma: PrismaClient,
  email: string,
  nome = 'Tutor Teste',
): Promise<string> {
  const usuario = await conta(prisma, email, 'Tutor');
  const cifragem = new Cifragem(process.env.CHAVE_CRIPTOGRAFIA ?? '');
  const cpf = cpfTeste();
  await prisma.tutor.create({
    data: {
      id: usuario.id,
      nome,
      cpfCifrado: cifragem.cifrar(cpf),
      cpfHash: cifragem.indiceCego(cpf),
    },
  });
  return usuario.id;
}

/** Funcionário ativo com o perfil Profissional da empresa (veterinário, tosador...). */
export async function criarProfissional(
  prisma: PrismaClient,
  empresaId: string,
  email: string,
  nome = 'Profissional Teste',
): Promise<string> {
  const perfil = await prisma.perfilAcesso.findFirstOrThrow({
    where: { empresaId, nome: 'Profissional' },
  });
  const usuario = await prisma.usuario.create({
    data: {
      email,
      senhaHash: await hash(SENHA_TESTE),
      emailConfirmado: true,
      status: 'ATIVA',
      tentativasLoginFalhas: 0,
      dataCadastro: new Date(),
      perfilId: perfil.id,
    },
  });
  const cifragem = new Cifragem(process.env.CHAVE_CRIPTOGRAFIA ?? '');
  const cpf = cpfTeste();
  await prisma.funcionarioEnterprise.create({
    data: {
      id: usuario.id,
      nome,
      cpfCifrado: cifragem.cifrar(cpf),
      cpfHash: cifragem.indiceCego(cpf),
      ativo: true,
      empresaId,
    },
  });
  return usuario.id;
}

/** Entra e devolve o access token. */
export async function entrar(
  app: INestApplication<App>,
  email: string,
): Promise<string> {
  const resposta = await request(app.getHttpServer())
    .post('/v1/auth/login')
    .send({ email, senha: SENHA_TESTE })
    .expect(200);
  return (resposta.body as { accessToken: string }).accessToken;
}

/** Cria um pet com o tutor como responsável principal (raça e espécie reaproveitadas). */
export async function criarPet(
  prisma: PrismaClient,
  tutorId: string,
  nome = 'Thor',
): Promise<string> {
  const especie =
    (await prisma.especie.findFirst({ where: { nome: 'Cachorro' } })) ??
    (await prisma.especie.create({ data: { nome: 'Cachorro' } }));
  const raca =
    (await prisma.raca.findFirst({ where: { especieId: especie.id } })) ??
    (await prisma.raca.create({
      data: { nome: 'SRD', especieId: especie.id },
    }));
  const pet = await prisma.pet.create({
    data: {
      nome,
      racaId: raca.id,
      sexo: 'MACHO',
      castrado: true,
      status: 'ATIVO',
      responsavelPet: {
        create: {
          tutorId,
          tipo: 'PRINCIPAL',
          ativo: true,
          dataVinculo: new Date(),
        },
      },
    },
  });
  return pet.id;
}

/** Compartilha o pet com a empresa nos escopos informados (RN15). */
export async function compartilhar(
  prisma: PrismaClient,
  petId: string,
  empresaId: string,
  escopos: (
    | 'PERFIL_BASICO'
    | 'VACINAS'
    | 'EXAMES'
    | 'MEDICAMENTOS'
    | 'ALERGIAS'
    | 'DOCUMENTOS'
    | 'LINHA_DO_TEMPO'
    | 'EDICAO_CLINICA'
  )[],
): Promise<void> {
  await prisma.compartilhamentoPet.create({
    data: {
      petId,
      empresaId,
      token: `compartilhamento-${petId}-${empresaId}`,
      escopos,
      status: 'ATIVO',
      dataConcessao: new Date(),
    },
  });
}

/**
 * Administrador da plataforma. Com `permissoes`, usa um perfil global próprio só com essas
 * permissões (para testar o acesso negado, RN33); sem elas, o perfil Administrador completo.
 */
export async function criarAdministrador(
  prisma: PrismaClient,
  email: string,
  permissoes?: string[],
): Promise<string> {
  let perfilNome = 'Administrador';
  if (permissoes) {
    perfilNome = `Admin teste ${email}`;
    const encontradas = await prisma.permissao.findMany({
      where: { codigo: { in: permissoes } },
    });
    await prisma.perfilAcesso.create({
      data: {
        nome: perfilNome,
        escopo: 'GLOBAL',
        perfilPermissao: {
          create: encontradas.map((p) => ({ permissaoId: p.id })),
        },
      },
    });
  }
  const usuario = await conta(prisma, email, perfilNome);
  await prisma.administrador.create({
    data: { id: usuario.id, nome: 'Administrador Teste' },
  });
  return usuario.id;
}
