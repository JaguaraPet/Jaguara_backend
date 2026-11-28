import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { ClientesService } from '../src/modulos/atendimento/aplicacao/clientes.service';
import { FilaEmailService } from '../src/modulos/notificacao/aplicacao/fila-email.service';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import { criarEmpresa, entrar } from './utils/cenario';

interface Cliente {
  id: string;
  consentimento: string;
  linkTermo?: string;
  possuiConta: boolean;
  cpf?: string;
}

describe('UC-21 · Clientes da empresa com e sem conta (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let empresaId: string;
  let token: string;
  let racaId: string;
  const emails: { tipo: string; para: string; link: string }[] = [];

  const http = () => request(app.getHttpServer());
  const autorizado = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`);
  const tokenDoLink = (link: string) => link.split('/termo/')[1];

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    jest
      .spyOn(app.get(FilaEmailService), 'enviar')
      .mockImplementation((tipo, para, dados) => {
        emails.push({ tipo, para, link: (dados as { link: string }).link });
        return Promise.resolve();
      });
    for (const tipo of [
      'CONSENTIMENTO_CLIENTE',
      'TERMOS_USO_APP',
      'POLITICA_PRIVACIDADE',
    ] as const) {
      await prisma.termoUso.create({
        data: {
          tipo,
          versao: '1.0',
          titulo: tipo,
          conteudo: 'Texto do termo',
          dataVigencia: new Date('2026-11-01'),
          obrigatorio: true,
        },
      });
    }
    const especie = await prisma.especie.create({ data: { nome: 'Cachorro' } });
    racaId = (
      await prisma.raca.create({ data: { nome: 'SRD', especieId: especie.id } })
    ).id;
    empresaId = await criarEmpresa(
      app,
      prisma,
      'clinica@exemplo.com',
      'Clínica Patas',
    );
    token = await entrar(app, 'clinica@exemplo.com');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('CT-21-01: deve salvar o cliente com consentimento vigente quando a empresa anexa o termo assinado', async () => {
    const resposta = await autorizado(
      http().post(`/v1/empresas/${empresaId}/clientes`),
    )
      .send({
        nome: 'Maria Souza',
        cpf: '52998224725',
        telefone: '11900000000',
        meioConsentimento: 'ASSINATURA_PRESENCIAL',
        evidenciaArquivoUrl: 'https://arquivos.exemplo.com/termo-maria.pdf',
      })
      .expect(201);
    const cliente = resposta.body as Cliente;
    expect(cliente).toMatchObject({
      consentimento: 'VIGENTE',
      possuiConta: false,
      cpf: '***.982.247-**',
    });
    const consentimento = await prisma.consentimento.findFirstOrThrow({
      where: { clienteId: cliente.id },
      include: { termo: true },
    });
    expect(consentimento).toMatchObject({
      meioColeta: 'ASSINATURA_PRESENCIAL',
      aceito: true,
    });
    expect(consentimento.termo.versao).toBe('1.0');
  });

  it('deve anexar o termo assinado como arquivo e abrir a cópia depois', async () => {
    const resposta = await autorizado(
      http().post(`/v1/empresas/${empresaId}/clientes`),
    )
      .send({
        nome: 'Joana Lima',
        meioConsentimento: 'ASSINATURA_PRESENCIAL',
        evidenciaArquivo: {
          nomeArquivo: 'termo joana.pdf',
          tamanhoBytes: 2048,
        },
      })
      .expect(201);
    const cliente = resposta.body as Cliente & {
      urlEnvioTermo: string;
      possuiTermoAnexado: boolean;
    };
    expect(cliente.possuiTermoAnexado).toBe(true);
    expect(cliente.urlEnvioTermo).toContain('X-Amz-Signature');
    const termo = await autorizado(
      http().get(
        `/v1/empresas/${empresaId}/clientes/${cliente.id}/consentimento/termo`,
      ),
    ).expect(200);
    expect((termo.body as { url: string }).url).toContain('termo_joana.pdf');
    const troca = await autorizado(
      http().post(
        `/v1/empresas/${empresaId}/clientes/${cliente.id}/consentimento/termo`,
      ),
    )
      .send({ nomeArquivo: 'termo.exe', tamanhoBytes: 10 })
      .expect(422);
    expect(troca.body).toMatchObject({ codigo: 'DADOS_INVALIDOS' });
  });

  it('deve exigir a cópia do termo no consentimento presencial', async () => {
    await autorizado(http().post(`/v1/empresas/${empresaId}/clientes`))
      .send({ nome: 'Sem cópia', meioConsentimento: 'ASSINATURA_PRESENCIAL' })
      .expect(422);
  });

  let pendente: Cliente;

  it('CT-21-02: deve bloquear o pet enquanto o cliente não consentiu e guardar só nome e contato', async () => {
    const resposta = await autorizado(
      http().post(`/v1/empresas/${empresaId}/clientes`),
    )
      .send({
        nome: 'João Lima',
        cpf: '11144477735',
        email: 'joao@exemplo.com',
        meioConsentimento: 'LINK_DIGITAL',
      })
      .expect(201);
    pendente = resposta.body as Cliente;
    expect(pendente).toMatchObject({ consentimento: 'PENDENTE' });
    expect(pendente.linkTermo).toContain('/termo/');
    expect(pendente.cpf).toBeUndefined();
    expect(emails.at(-1)).toMatchObject({
      tipo: 'TERMO_CLIENTE',
      para: 'joao@exemplo.com',
    });

    const bloqueado = await autorizado(
      http().post(`/v1/empresas/${empresaId}/clientes/${pendente.id}/pets`),
    )
      .send({ nome: 'Rex', racaId, sexo: 'MACHO', castrado: false })
      .expect(409);
    expect(bloqueado.body).toMatchObject({ codigo: 'RN41_SEM_CONSENTIMENTO' });
  });

  it('CT-21-04: deve registrar data, hora, IP e versão e liberar o cadastro quando o cliente marca "Concordo"', async () => {
    const linkToken = tokenDoLink(pendente.linkTermo!);
    const pagina = await http()
      .get(`/v1/consentimentos-clientes/${linkToken}`)
      .expect(200);
    expect(pagina.body).toMatchObject({
      empresa: 'Clínica Patas',
      situacao: 'PENDENTE',
      termo: { versao: '1.0' },
    });

    await http()
      .post(`/v1/consentimentos-clientes/${linkToken}/aceite`)
      .expect(204);
    const consentimento = await prisma.consentimento.findFirstOrThrow({
      where: { clienteId: pendente.id },
    });
    expect(consentimento.aceito).toBe(true);
    expect(consentimento.ipOrigem).toBeTruthy();
    expect(emails.at(-1)).toMatchObject({
      tipo: 'COMPROVANTE_CONSENTIMENTO',
      para: 'joao@exemplo.com',
    });

    const pet = await autorizado(
      http().post(`/v1/empresas/${empresaId}/clientes/${pendente.id}/pets`),
    )
      .send({
        nome: 'Rex',
        racaId,
        sexo: 'MACHO',
        castrado: false,
        dataNascimento: '2022-05-10',
      })
      .expect(201);
    expect(pet.body).toMatchObject({
      nome: 'Rex',
      especie: 'Cachorro',
      raca: 'SRD',
      status: 'ATIVO',
    });
  });

  it('CT-21-03: deve ligar o cadastro e o pet ao tutor quando o cliente cria a conta com o mesmo e-mail', async () => {
    await http()
      .post('/v1/auth/cadastro/tutor')
      .send({
        nome: 'João Lima',
        cpf: '11144477735',
        email: 'joao@exemplo.com',
        senha: 'senhaForte1',
        aceiteTermos: true,
      })
      .expect(201);
    const confirmacao = emails
      .filter((e) => e.tipo === 'CONFIRMACAO_CADASTRO')
      .at(-1)!;
    await http()
      .post('/v1/auth/confirmacao')
      .send({ token: decodeURIComponent(confirmacao.link.split('token=')[1]) })
      .expect(204);

    const cliente = await prisma.cliente.findUniqueOrThrow({
      where: { id: pendente.id },
      include: { clientePet: true },
    });
    expect(cliente.tutorId).not.toBeNull();
    const responsavel = await prisma.responsavelPet.findFirstOrThrow({
      where: { petId: cliente.clientePet[0].petId },
    });
    expect(responsavel).toMatchObject({
      tutorId: cliente.tutorId,
      tipo: 'PRINCIPAL',
    });
  });

  it('CT-21-06: deve revogar, inativar e anonimizar quando o cliente usa o link do comprovante', async () => {
    const linkToken = tokenDoLink(pendente.linkTermo!);
    await http()
      .post(`/v1/consentimentos-clientes/${linkToken}/revogacao`)
      .expect(204);
    const cliente = await prisma.cliente.findUniqueOrThrow({
      where: { id: pendente.id },
    });
    expect(cliente).toMatchObject({
      ativo: false,
      nome: 'Cliente removido',
      email: null,
      cpfHash: null,
    });
    const pagina = await http()
      .get(`/v1/consentimentos-clientes/${linkToken}`)
      .expect(200);
    expect(pagina.body).toMatchObject({ situacao: 'REVOGADO' });
  });

  it('CT-21-05: deve excluir o pré-cadastro pendente há mais de 7 dias', async () => {
    const resposta = await autorizado(
      http().post(`/v1/empresas/${empresaId}/clientes`),
    )
      .send({
        nome: 'Ana Pendente',
        email: 'pendente@exemplo.com',
        meioConsentimento: 'LINK_DIGITAL',
      })
      .expect(201);
    const id = (resposta.body as Cliente).id;
    const oitoDias = new Date(Date.now() - 8 * 86_400_000);
    await prisma.cliente.update({
      where: { id },
      data: { criadoEm: oitoDias },
    });
    await prisma.consentimento.updateMany({
      where: { clienteId: id },
      data: { criadoEm: oitoDias },
    });

    await http()
      .get(
        `/v1/consentimentos-clientes/${tokenDoLink((resposta.body as Cliente).linkTermo!)}`,
      )
      .expect(410);
    expect(await app.get(ClientesService).limparPreCadastros()).toBe(1);
    expect(await prisma.cliente.findUnique({ where: { id } })).toBeNull();
  });

  it('deve importar clientes da planilha com os pets e ignorar repetidos e inválidos', async () => {
    await prisma.raca.create({
      data: {
        nome: 'Outra (digitar)',
        especieId: (await prisma.especie.findFirstOrThrow()).id,
      },
    });
    await autorizado(
      http().post(`/v1/empresas/${empresaId}/clientes/importacao`),
    )
      .send({ declaracaoConsentimento: false, linhas: [{ nome: 'X' }] })
      .expect(422);
    const resposta = await autorizado(
      http().post(`/v1/empresas/${empresaId}/clientes/importacao`),
    )
      .send({
        declaracaoConsentimento: true,
        linhas: [
          {
            nome: 'Paulo Reis',
            telefone: '(11) 97777-0000',
            petNome: 'Bob',
            petEspecie: 'cão',
            petRaca: 'Mestiço de beagle',
            petSexo: 'M',
            petNascimento: '10/02/2020',
          },
          { nome: 'Paulo Reis', telefone: '11977770000' },
          { nome: '', email: 'sem@nome.com' },
          { nome: 'Rita', petNome: 'Fofa', petEspecie: 'Dragão' },
        ],
      })
      .expect(201);
    expect(resposta.body).toEqual({
      criados: 1,
      petsCriados: 1,
      ignorados: [
        { linha: 3, nome: 'Paulo Reis', motivo: 'Já é cliente da empresa.' },
        { linha: 4, nome: '', motivo: 'Sem nome.' },
        { linha: 5, nome: 'Rita', motivo: 'Espécie "Dragão" não reconhecida.' },
      ],
    });
    const pet = await prisma.pet.findFirstOrThrow({ where: { nome: 'Bob' } });
    expect(pet).toMatchObject({
      racaDescricao: 'Mestiço de beagle',
      sexo: 'MACHO',
    });
    const consentimento = await prisma.consentimento.findFirstOrThrow({
      where: { cliente: { nome: 'Paulo Reis' } },
    });
    expect(consentimento).toMatchObject({
      meioColeta: 'IMPORTACAO',
      aceito: true,
    });
  });

  it('deve listar os clientes com a situação do consentimento', async () => {
    const lista = await autorizado(
      http().get(`/v1/empresas/${empresaId}/clientes`),
    ).expect(200);
    expect(
      (lista.body as Cliente[]).map((c) => c.consentimento).sort(),
    ).toEqual(['REVOGADO', 'VIGENTE', 'VIGENTE', 'VIGENTE']);
  });
});
