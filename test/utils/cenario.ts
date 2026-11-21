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
