/**
 * Dados fictícios para desenvolvimento e testes (JAG-100). Nenhum dado pessoal real (ARQ-02):
 * nomes inventados, e-mails no domínio reservado exemplo.com e CPFs gerados com dígitos válidos.
 *
 * Uso: `npm run prisma:seed` (banco do DATABASE_URL) ou `npm run prisma:seed:teste`
 * (banco do DATABASE_URL_TESTE). Apaga os dados do banco antes de inserir; por isso se recusa
 * a rodar com NODE_ENV=production.
 */
import 'dotenv/config';
import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  CategoriaServico,
  DiaSemana,
  EscopoPerfil,
  PrismaClient,
  Sexo,
  StatusConta,
  StatusPet,
  TipoEmpresa,
  TipoRecurso,
  TipoResponsavel,
  TipoTermo,
} from '../src/generated/prisma/client';
import { Cifragem } from '../src/compartilhado/cripto/cifragem';
import { criarClinicaDemonstracao } from '../src/modulos/demonstracao/aplicacao/clinica-demonstracao';
import {
  PERFIS_EMPRESA_PADRAO,
  PERFIS_GLOBAIS,
  PERMISSOES,
} from '../src/modulos/acesso/dominio/catalogo-permissoes';

/** Senha de todos os usuários do seed. Só para desenvolvimento local. */
export const SENHA_SEED = 'Jaguara@2026';

const urlBanco = process.argv.includes('--teste')
  ? process.env.DATABASE_URL_TESTE
  : process.env.DATABASE_URL;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: urlBanco }),
});
const cifragem = new Cifragem(process.env.CHAVE_CRIPTOGRAFIA ?? '');

/** CPF fictício com dígitos verificadores válidos, gerado a partir de 9 dígitos-base. */
function cpfFicticio(base: string): string {
  const dig = (b: string) => {
    const soma = [...b].reduce((t, n, i) => t + Number(n) * (b.length + 1 - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dig(base);
  return `${base}${d1}${dig(base + d1)}`;
}

/** CNPJ fictício com dígitos verificadores válidos, a partir de 12 dígitos-base. */
function cnpjFicticio(base: string): string {
  const dig = (b: string) => {
    const pesos = b.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = [...b].reduce((t, n, i) => t + Number(n) * pesos[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dig(base);
  return `${base}${d1}${dig(base + d1)}`;
}

const hora = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00Z`);
const dia = (aaaammdd: string) => new Date(`${aaaammdd}T00:00:00Z`);

async function limpar() {
  const tabelas = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const lista = tabelas.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${lista} RESTART IDENTITY CASCADE`);
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('O seed apaga os dados e não roda em produção.');
  }
  await limpar();
  const senhaHash = await hash(SENHA_SEED);
  const agora = new Date();

  // Permissões e perfis globais
  const permissoes = new Map<string, string>();
  for (const [codigo, p] of Object.entries(PERMISSOES)) {
    const criada = await prisma.permissao.create({
      data: { codigo, modulo: p.modulo, descricao: p.descricao },
    });
    permissoes.set(codigo, criada.id);
  }
  const criarPerfil = async (
    nome: string,
    descricao: string,
    codigos: readonly string[],
    empresaId?: string,
  ) =>
    prisma.perfilAcesso.create({
      data: {
        nome,
        descricao,
        escopo: empresaId ? EscopoPerfil.EMPRESA : EscopoPerfil.GLOBAL,
        empresaId,
        perfilPermissao: {
          create: codigos.map((c) => ({ permissaoId: permissoes.get(c)! })),
        },
      },
    });
  const perfilTutor = await criarPerfil('Tutor', PERFIS_GLOBAIS.Tutor.descricao, PERFIS_GLOBAIS.Tutor.permissoes);
  const perfilAdmin = await criarPerfil(
    'Administrador',
    PERFIS_GLOBAIS.Administrador.descricao,
    PERFIS_GLOBAIS.Administrador.permissoes,
  );
  // A conta da empresa (dona) usa um perfil global de proprietário até ter os perfis próprios.
  const perfilEmpresaGlobal = await criarPerfil(
    'Empresa',
    'Conta principal de uma empresa Enterprise',
    PERFIS_EMPRESA_PADRAO.Proprietário.permissoes,
  );

  const criarUsuario = (email: string, perfilId: string, telefone?: string) =>
    prisma.usuario.create({
      data: {
        email,
        senhaHash,
        telefone,
        emailConfirmado: true,
        status: StatusConta.ATIVA,
        tentativasLoginFalhas: 0,
        dataCadastro: agora,
        perfilId,
      },
    });

  // Administrador
  const admin = await criarUsuario('admin@jaguara.exemplo.com', perfilAdmin.id);
  await prisma.administrador.create({ data: { id: admin.id, nome: 'Administração Jaguara' } });

  // Espécies e raças
  const especies: Record<string, string[]> = {
    Cachorro: ['Sem raça definida', 'Labrador', 'Golden Retriever', 'Poodle', 'Shih Tzu', 'Bulldog Francês', 'Pinscher', 'Yorkshire'],
    Gato: ['Sem raça definida', 'Persa', 'Siamês', 'Maine Coon'],
    Ave: ['Calopsita', 'Periquito'],
    Roedor: ['Hamster', 'Porquinho-da-índia'],
  };
  const racas = new Map<string, string>();
  for (const [nome, lista] of Object.entries(especies)) {
    const especie = await prisma.especie.create({ data: { nome } });
    for (const raca of lista) {
      const r = await prisma.raca.create({ data: { nome: raca, especieId: especie.id } });
      racas.set(`${nome}/${raca}`, r.id);
    }
  }

  // Tutores
  const tutores = [
    { email: 'ana.tutora@exemplo.com', nome: 'Ana Ribeiro', cpf: cpfFicticio('100200300'), tel: '(11) 90000-0001', cidade: 'São Paulo' },
    { email: 'bruno.tutor@exemplo.com', nome: 'Bruno Carvalho', cpf: cpfFicticio('100200301'), tel: '(11) 90000-0002', cidade: 'São Paulo' },
    { email: 'carla.tutora@exemplo.com', nome: 'Carla Mendes', cpf: cpfFicticio('100200302'), tel: '(19) 90000-0003', cidade: 'Campinas' },
  ];
  const idsTutores: string[] = [];
  for (const t of tutores) {
    const u = await criarUsuario(t.email, perfilTutor.id, t.tel);
    await prisma.tutor.create({
      data: {
        id: u.id,
        nome: t.nome,
        cpfCifrado: cifragem.cifrar(t.cpf),
        cpfHash: cifragem.indiceCego(t.cpf),
        enderecoCidade: t.cidade,
        enderecoUf: 'SP',
      },
    });
    idsTutores.push(u.id);
  }
  const [ana, bruno, carla] = idsTutores;

  // Pets
  const pets = [
    { nome: 'Thor', raca: 'Cachorro/Labrador', sexo: Sexo.MACHO, nasc: '2021-03-10', peso: '29.5', cor: 'Caramelo', castrado: true, chip: '985141000000001', donos: [ana, bruno] },
    { nome: 'Mia', raca: 'Gato/Siamês', sexo: Sexo.FEMEA, nasc: '2022-07-22', peso: '4.1', cor: 'Creme e marrom', castrado: true, chip: null, donos: [ana] },
    { nome: 'Pipoca', raca: 'Cachorro/Shih Tzu', sexo: Sexo.FEMEA, nasc: '2019-11-02', peso: '6.3', cor: 'Branco e dourado', castrado: false, chip: '985141000000002', donos: [bruno] },
    { nome: 'Kiwi', raca: 'Ave/Calopsita', sexo: Sexo.MACHO, nasc: '2023-01-15', peso: '0.09', cor: 'Cinza', castrado: false, chip: null, donos: [carla] },
  ];
  const idsPets: Record<string, string> = {};
  for (const p of pets) {
    const pet = await prisma.pet.create({
      data: {
        nome: p.nome,
        racaId: racas.get(p.raca)!,
        sexo: p.sexo,
        dataNascimento: dia(p.nasc),
        pesoKg: p.peso,
        cor: p.cor,
        castrado: p.castrado,
        microchip: p.chip,
        status: StatusPet.ATIVO,
      },
    });
    idsPets[p.nome] = pet.id;
    for (const [i, tutorId] of p.donos.entries()) {
      await prisma.responsavelPet.create({
        data: {
          petId: pet.id,
          tutorId,
          tipo: i === 0 ? TipoResponsavel.PRINCIPAL : TipoResponsavel.ADICIONAL,
          dataVinculo: agora,
          ativo: true,
        },
      });
    }
  }

  // Empresas, funcionários, serviços e recursos
  const empresas = [
    {
      email: 'banho.cheiroso@exemplo.com', cnpj: cnpjFicticio('445556660001'), razao: 'Pet Shop Cheiroso Ltda.',
      fantasia: 'Pet Shop Cheiroso', tipo: TipoEmpresa.PET_SHOP, bairro: 'Vila Mariana',
      servicos: [
        { nome: 'Banho', categoria: CategoriaServico.BANHO_TOSA, preco: '70.00', duracao: 60 },
        { nome: 'Banho e tosa', categoria: CategoriaServico.BANHO_TOSA, preco: '110.00', duracao: 90 },
      ],
      recursos: [{ nome: 'Mesa de banho', tipo: TipoRecurso.EQUIPAMENTO }],
      funcionarios: [
        { email: 'tosador.leo@exemplo.com', nome: 'Leonardo Pires', cpf: cpfFicticio('200300402'), cargo: 'Tosador', perfil: 'Profissional' },
      ],
    },
  ];

  const idsEmpresas: string[] = [];
  for (const e of empresas) {
    const u = await criarUsuario(e.email, perfilEmpresaGlobal.id, '(11) 3000-0000');
    await prisma.empresaEnterprise.create({
      data: {
        id: u.id,
        cnpj: e.cnpj,
        razaoSocial: e.razao,
        nomeFantasia: e.fantasia,
        tipo: e.tipo,
        enderecoCep: '05400-000',
        enderecoLogradouro: 'Rua das Flores',
        enderecoNumero: '100',
        enderecoBairro: e.bairro,
        enderecoCidade: 'São Paulo',
        enderecoUf: 'SP',
      },
    });
    idsEmpresas.push(u.id);

    const perfis: Record<string, string> = {};
    for (const [nome, p] of Object.entries(PERFIS_EMPRESA_PADRAO)) {
      perfis[nome] = (await criarPerfil(nome, p.descricao, p.permissoes, u.id)).id;
    }
    for (const s of e.servicos) {
      await prisma.servico.create({
        data: {
          empresaId: u.id,
          nome: s.nome,
          descricao: `${s.nome} na ${e.fantasia}.`,
          categoria: s.categoria,
          preco: s.preco,
          duracaoMinutos: s.duracao,
          ativo: true,
        },
      });
    }
    for (const r of e.recursos) {
      const recurso = await prisma.recurso.create({
        data: { empresaId: u.id, nome: r.nome, tipo: r.tipo, ativo: true },
      });
      for (const diaSemana of [DiaSemana.SEGUNDA, DiaSemana.TERCA, DiaSemana.QUARTA, DiaSemana.QUINTA, DiaSemana.SEXTA]) {
        await prisma.horarioAtuacao.create({
          data: { recursoId: recurso.id, diaSemana, horaInicio: hora('08:00'), horaFim: hora('18:00') },
        });
      }
    }
    for (const f of e.funcionarios) {
      const uf = await criarUsuario(f.email, perfis[f.perfil]);
      await prisma.funcionarioEnterprise.create({
        data: {
          id: uf.id,
          nome: f.nome,
          cpfCifrado: cifragem.cifrar(f.cpf),
          cpfHash: cifragem.indiceCego(f.cpf),
          cargo: f.cargo,
          ativo: true,
          empresaId: u.id,
        },
      });
      for (const diaSemana of [DiaSemana.SEGUNDA, DiaSemana.TERCA, DiaSemana.QUARTA, DiaSemana.QUINTA, DiaSemana.SEXTA, DiaSemana.SABADO]) {
        await prisma.horarioAtuacao.create({
          data: {
            funcionarioId: uf.id,
            diaSemana,
            horaInicio: hora(diaSemana === DiaSemana.SABADO ? '09:00' : '08:00'),
            horaFim: hora(diaSemana === DiaSemana.SABADO ? '13:00' : '18:00'),
          },
        });
      }
    }
  }

  // Termos vigentes (texto resumido; o texto completo está no Jaguara_doc, seção 08-juridico)
  const termos = [
    { tipo: TipoTermo.TERMOS_USO_APP, titulo: 'Termos de uso do app Jaguara', obrigatorio: true },
    { tipo: TipoTermo.TERMOS_ENTERPRISE, titulo: 'Termos de uso do Jaguara Enterprise', obrigatorio: true },
    { tipo: TipoTermo.POLITICA_PRIVACIDADE, titulo: 'Política de privacidade', obrigatorio: true },
    { tipo: TipoTermo.COMUNICACAO_MARKETING, titulo: 'Comunicações de novidades', obrigatorio: false },
  ];
  for (const t of termos) {
    await prisma.termoUso.create({
      data: {
        ...t,
        versao: '1.0',
        conteudo: `${t.titulo}, versão 1.0. Texto completo no Jaguara_doc (08-juridico).`,
        dataVigencia: dia('2026-11-01'),
      },
    });
  }

  // Clínica Patas: clínica completa, com uma semana de agenda, atendimentos, vacinas, cobranças
  // e pedidos pendentes em volta de hoje (o mesmo gerador da demonstração pública).
  await criarClinicaDemonstracao(prisma, {
    agora,
    sufixo: 'seed',
    cifragem,
    senhaHash,
    emails: { empresa: 'clinica.patas@exemplo.com', tutor: 'marina.tutora@exemplo.com' },
    nomeFantasia: 'Clínica Patas',
  });

  const contagem = {
    usuarios: await prisma.usuario.count(),
    pets: await prisma.pet.count(),
    empresas: await prisma.empresaEnterprise.count(),
    servicos: await prisma.servico.count(),
  };
  console.log('Seed concluído:', contagem);
  console.log(`Senha de todos os usuários: ${SENHA_SEED}`);
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
