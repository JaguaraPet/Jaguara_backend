import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import {
  criarEmpresa,
  criarPet,
  criarProfissional,
  criarTutor,
  entrar,
} from './utils/cenario';

describe('UC-18 · Relatórios da empresa (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let empresaId: string;
  let tokenDono: string;
  let tokenVet: string;
  let tokenOutra: string;

  const http = () => request(app.getHttpServer());
  const como = (t: string, r: request.Test) =>
    r.set('Authorization', `Bearer ${t}`);
  const rota = (tipo: string, id = empresaId) =>
    `/v1/empresas/${id}/relatorios/${tipo}?de=2026-11-01&ate=2026-11-30`;

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    empresaId = await criarEmpresa(app, prisma, 'clinica@exemplo.com');
    tokenDono = await entrar(app, 'clinica@exemplo.com');
    await criarProfissional(prisma, empresaId, 'vet@exemplo.com', 'Dra. Júlia');
    tokenVet = await entrar(app, 'vet@exemplo.com');
    await criarEmpresa(app, prisma, 'outra@exemplo.com', 'Outra');
    tokenOutra = await entrar(app, 'outra@exemplo.com');
    const anaId = await criarTutor(prisma, 'ana@exemplo.com', 'Ana');
    const petId = await criarPet(prisma, anaId, 'Thor');
    const servico = await prisma.servico.create({
      data: {
        empresaId,
        nome: 'Banho',
        descricao: 'Banho',
        categoria: 'BANHO_TOSA',
        preco: 60,
        duracaoMinutos: 60,
        ativo: true,
      },
    });
    const marcar = async (
      inicio: string,
      status: 'REALIZADO' | 'NAO_COMPARECEU' | 'AGENDADO',
    ) => {
      const ag = await prisma.agendamento.create({
        data: {
          servicoId: servico.id,
          petId,
          dataHoraInicio: new Date(inicio),
          dataHoraFim: new Date(new Date(inicio).getTime() + 3_600_000),
          precoContratado: 60,
          status,
          criadoEm: new Date(),
        },
      });
      if (status === 'REALIZADO') {
        await prisma.pagamento.create({
          data: {
            codigoTransacao: `teste-${ag.id}`,
            valor: 60,
            dataHora: new Date(inicio),
            metodo: 'PIX',
            status: 'ACEITO',
            dataConfirmacao: new Date(inicio),
            pagadorId: anaId,
            recebedorId: empresaId,
            agendamentoId: ag.id,
          },
        });
      }
    };
    await marcar('2026-11-05T13:00:00Z', 'REALIZADO');
    await marcar('2026-11-12T13:00:00Z', 'REALIZADO');
    await marcar('2026-11-19T13:00:00Z', 'NAO_COMPARECEU');
    await marcar('2026-12-03T13:00:00Z', 'AGENDADO');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('CT-18-01: deve gerar o relatório de atendimentos do mês', async () => {
    const resposta = await como(
      tokenDono,
      http().get(rota('atendimentos')),
    ).expect(200);
    expect(resposta.body).toMatchObject({
      tipo: 'atendimentos',
      total: 3,
      taxaComparecimento: 66.7,
      porServico: [{ chave: 'Banho', quantidade: 3 }],
    });
  });

  it('deve gerar o financeiro e exportar em PDF', async () => {
    const financeiro = await como(
      tokenDono,
      http().get(rota('financeiro')),
    ).expect(200);
    expect(financeiro.body).toMatchObject({
      faturamento: 120,
      pagamentosConfirmados: 2,
      porMetodo: [{ chave: 'PIX', quantidade: 2, total: 120 }],
    });
    const pdf = await como(
      tokenDono,
      http()
        .get(rota('atendimentos'))
        .set('Accept', 'application/pdf')
        .buffer(true)
        .parse((res, pronto) => {
          const partes: Buffer[] = [];
          res.on('data', (p: Buffer) => partes.push(p));
          res.on('end', () => pronto(null, Buffer.concat(partes)));
        }),
    ).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).toString('latin1')).toContain(
      '(Agendamentos: 3) Tj',
    );
    expect(
      await prisma.relatorio.count({ where: { tipo: 'OPERACIONAL' } }),
    ).toBe(2);
  });

  it('CT-18-02: deve bloquear quem não tem permissão de relatórios', async () => {
    await como(tokenVet, http().get(rota('atendimentos'))).expect(403);
    await como(tokenOutra, http().get(rota('atendimentos'))).expect(403);
    await como(tokenDono, http().get(rota('outro'))).expect(404);
  });
});
