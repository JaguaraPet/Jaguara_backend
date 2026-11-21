import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { FilaEmailService } from '../src/modulos/notificacao/aplicacao/fila-email.service';
import { criarAppTeste } from './utils/app';
import { criarPrismaTeste, limparBanco } from './utils/banco';
import {
  criarEmpresa,
  criarProfissional,
  criarTutor,
  entrar,
} from './utils/cenario';

interface Agendamento {
  id: string;
  precoContratado: number;
  status: string;
}

describe('UC-39 e UC-24 · Agendamento pela empresa e agenda (API)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let empresaId: string;
  let token: string;
  let tokenTutor: string;
  let servicoId: string;
  let profissionalId: string;
  let salaId: string;
  let thor: string;
  let mia: string;
  const emails: string[] = [];
  const amanha9h = (() => {
    const d = new Date(Date.now() + 2 * 86_400_000);
    return new Date(
      `${d.toISOString().slice(0, 10)}T09:00:00-03:00`,
    ).toISOString();
  })();
  const mais = (iso: string, minutos: number) =>
    new Date(new Date(iso).getTime() + minutos * 60_000).toISOString();

  const http = () => request(app.getHttpServer());
  const autorizado = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    prisma = criarPrismaTeste();
    await limparBanco(prisma);
    app = await criarAppTeste();
    jest
      .spyOn(app.get(FilaEmailService), 'enviar')
      .mockImplementation((tipo) => {
        emails.push(tipo);
        return Promise.resolve();
      });
    empresaId = await criarEmpresa(app, prisma, 'banho@exemplo.com');
    token = await entrar(app, 'banho@exemplo.com');
    profissionalId = await criarProfissional(
      prisma,
      empresaId,
      'tosador@exemplo.com',
    );
    salaId = (
      await prisma.recurso.create({
        data: { empresaId, nome: 'Sala de banho', tipo: 'SALA', ativo: true },
      })
    ).id;
    servicoId = (
      await prisma.servico.create({
        data: {
          empresaId,
          nome: 'Banho',
          descricao: 'Banho',
          categoria: 'BANHO_TOSA',
          preco: 60,
          duracaoMinutos: 60,
          ativo: true,
        },
      })
    ).id;
    const tutorId = await criarTutor(prisma, 'ana@exemplo.com', 'Ana');
    tokenTutor = await entrar(app, 'ana@exemplo.com');
    const especie = await prisma.especie.create({ data: { nome: 'Cachorro' } });
    const raca = await prisma.raca.create({
      data: { nome: 'SRD', especieId: especie.id },
    });
    const criarPet = async (nome: string) => {
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
      await prisma.compartilhamentoPet.create({
        data: {
          petId: pet.id,
          empresaId,
          token: `token-${nome}`,
          escopos: ['PERFIL_BASICO'],
          status: 'ATIVO',
          dataConcessao: new Date(),
        },
      });
      return pet.id;
    };
    thor = await criarPet('Thor');
    mia = await criarPet('Mia');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  let primeiro: Agendamento;

  it('CT-39-01: deve criar o agendamento e avisar o tutor quando profissional e pet estão livres', async () => {
    const criado = await autorizado(http().post('/v1/agendamentos'))
      .send({
        servicoId,
        petId: thor,
        dataHoraInicio: amanha9h,
        profissionalId,
        recursoId: salaId,
      })
      .expect(201);
    primeiro = criado.body as Agendamento;
    expect(primeiro).toMatchObject({
      status: 'AGENDADO',
      precoContratado: 60,
      dataHoraFim: mais(amanha9h, 60),
    });
    expect(emails).toContain('AGENDAMENTO_CRIADO');
  });

  it('CT-39-02: deve recusar outro serviço na mesma sala às 9h (RN29)', async () => {
    const resposta = await autorizado(http().post('/v1/agendamentos'))
      .send({
        servicoId,
        petId: mia,
        dataHoraInicio: amanha9h,
        recursoId: salaId,
      })
      .expect(409);
    expect(resposta.body).toMatchObject({ codigo: 'RN29_CONFLITO_RECURSO' });
  });

  it('CT-24-02: deve bloquear a remarcação para um horário em que o profissional já atende (RN29)', async () => {
    const outro = await autorizado(http().post('/v1/agendamentos'))
      .send({
        servicoId,
        petId: mia,
        dataHoraInicio: mais(amanha9h, 120),
        profissionalId,
      })
      .expect(201);
    const resposta = await autorizado(
      http().patch(`/v1/agendamentos/${(outro.body as Agendamento).id}`),
    )
      .send({ dataHoraInicio: amanha9h, dataHoraFim: mais(amanha9h, 60) })
      .expect(409);
    expect(resposta.body).toMatchObject({
      codigo: 'RN29_CONFLITO_PROFISSIONAL',
    });
  });

  it('deve mostrar a semana com os agendamentos e deixar o tutor cancelar', async () => {
    const semana = amanha9h.slice(0, 10);
    const agenda = await autorizado(
      http().get(`/v1/empresas/${empresaId}/agenda?semana=${semana}`),
    ).expect(200);
    expect(
      (agenda.body as { agendamentos: unknown[] }).agendamentos,
    ).toHaveLength(2);

    await http()
      .post(`/v1/agendamentos/${primeiro.id}/cancelamento`)
      .set('Authorization', `Bearer ${tokenTutor}`)
      .send({ motivo: 'Viagem' })
      .expect(204);
    const filtrada = await autorizado(
      http().get(
        `/v1/empresas/${empresaId}/agenda?semana=${semana}&recursoId=${salaId}`,
      ),
    ).expect(200);
    expect(
      (filtrada.body as { agendamentos: Agendamento[] }).agendamentos,
    ).toEqual([
      expect.objectContaining({ id: primeiro.id, status: 'CANCELADO' }),
    ]);
  });

  it('deve negar agendamento para pet sem vínculo com a empresa', async () => {
    const raca = await prisma.raca.findFirstOrThrow();
    const estranho = await prisma.pet.create({
      data: {
        nome: 'Rex',
        racaId: raca.id,
        sexo: 'MACHO',
        castrado: false,
        status: 'ATIVO',
      },
    });
    await autorizado(http().post('/v1/agendamentos'))
      .send({
        servicoId,
        petId: estranho.id,
        dataHoraInicio: mais(amanha9h, 300),
      })
      .expect(403);
  });
});
