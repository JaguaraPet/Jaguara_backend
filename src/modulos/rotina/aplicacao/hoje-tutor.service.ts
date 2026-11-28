import { Injectable } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import {
  hojeBrasilia,
  instanteBrasilia,
  somarDias,
} from '../../notificacao/dominio/lembretes';
import { PoliticaAcessoPet } from '../../pet/aplicacao/politica-acesso-pet';
import { ocorreEm } from '../dominio/rotina';

export interface ItemDoDia {
  tipo: 'REMEDIO' | 'ROTINA';
  /** Tratamento ou rotina */
  id: string;
  titulo: string;
  detalhe: string | null;
  /** HH:MM em Brasília; null para rotinas sem hora (ex.: banho) */
  horario: string | null;
  /** Instante previsto da dose (REMEDIO), para registrar */
  previstaPara: string | null;
  feito: boolean;
  feitoPor: string | null;
  feitoEm: string | null;
}

const hora = (d: Date) =>
  d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
const primeiroNome = (nome?: string | null) => nome?.split(' ')[0] ?? null;

/**
 * Tela Hoje do tutor: o que cada pet precisa hoje (remédios e rotinas, com quem já fez), os
 * próximos agendamentos e as vacinas que vencem. É o motivo para abrir o app todo dia e o que
 * evita, numa família, o remédio dado duas vezes ou nenhuma.
 */
@Injectable()
export class HojeTutorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly politicaPet: PoliticaAcessoPet,
  ) {}

  async hoje(usuario: UsuarioAutenticado, agora = new Date()) {
    const data = hojeBrasilia(agora);
    const inicioDia = instanteBrasilia(data, '00:00');
    const fimDia = instanteBrasilia(somarDias(data, 1), '00:00');
    const pets = await this.prisma.pet.findMany({
      where: {
        status: 'ATIVO',
        responsavelPet: { some: { tutorId: usuario.sub, ativo: true } },
      },
      select: {
        id: true,
        nome: true,
        fotoUrl: true,
        raca: { select: { especie: { select: { nome: true } } } },
      },
      orderBy: { nome: 'asc' },
    });
    const ids = pets.map((p) => p.id);

    const [rotinas, tratamentos, agendamentos, doses] = await Promise.all([
      this.prisma.rotina.findMany({
        where: { petId: { in: ids }, ativa: true },
        include: {
          registros: {
            where: { data: new Date(data) },
            include: {
              feitoPor: { select: { tutor: { select: { nome: true } } } },
            },
          },
        },
      }),
      this.prisma.tratamentoMedicamentoso.findMany({
        where: {
          status: 'ATIVO',
          dataInicio: { lte: new Date(data) },
          OR: [{ dataFim: null }, { dataFim: { gte: new Date(data) } }],
          registroClinico: { petId: { in: ids }, valido: true },
        },
        include: {
          registroClinico: { select: { petId: true } },
          doseRegistrada: {
            where: { previstaPara: { gte: inicioDia, lt: fimDia } },
            include: {
              feitoPor: { select: { tutor: { select: { nome: true } } } },
            },
          },
        },
      }),
      this.prisma.agendamento.findMany({
        where: {
          petId: { in: ids },
          status: 'AGENDADO',
          dataHoraInicio: {
            gte: agora,
            lt: new Date(agora.getTime() + 14 * 86_400_000),
          },
        },
        include: {
          pet: { select: { nome: true } },
          servico: {
            select: { nome: true, empresa: { select: { nomeFantasia: true } } },
          },
        },
        orderBy: { dataHoraInicio: 'asc' },
        take: 6,
      }),
      this.prisma.vacinacao.findMany({
        where: { registroClinico: { petId: { in: ids }, valido: true } },
        select: {
          nomeVacina: true,
          dataProximaDose: true,
          dataAplicacao: true,
          registroClinico: { select: { petId: true } },
        },
        orderBy: { dataAplicacao: 'desc' },
      }),
    ]);

    const itensPorPet = new Map<string, ItemDoDia[]>(ids.map((id) => [id, []]));
    for (const r of rotinas) {
      if (
        !ocorreEm(
          {
            frequencia: r.frequencia,
            intervaloDias: r.intervaloDias,
            diasSemana: r.diasSemana,
            dataInicio: r.dataInicio.toISOString().slice(0, 10),
          },
          data,
        )
      )
        continue;
      const horarios = r.horarios.length ? r.horarios : [''];
      for (const h of horarios) {
        const feito = r.registros.find((g) => g.horario === h);
        itensPorPet.get(r.petId)!.push({
          tipo: 'ROTINA',
          id: r.id,
          titulo: r.titulo,
          detalhe: null,
          horario: h || null,
          previstaPara: null,
          feito: !!feito,
          feitoPor: primeiroNome(feito?.feitoPor.tutor?.nome),
          feitoEm: feito?.feitoEm.toISOString() ?? null,
        });
      }
    }
    for (const t of tratamentos) {
      const passo = t.intervaloHoras * 3_600_000;
      const primeira = instanteBrasilia(
        t.dataInicio.toISOString().slice(0, 10),
        t.horaPrimeiraDose,
      ).getTime();
      const ultimo = t.dataFim
        ? instanteBrasilia(
            somarDias(t.dataFim.toISOString().slice(0, 10), 1),
            '00:00',
          ).getTime()
        : Number.POSITIVE_INFINITY;
      // Primeira dose do dia: avança do início do tratamento em passos do intervalo.
      let instante =
        primeira >= inicioDia.getTime()
          ? primeira
          : primeira +
            Math.ceil((inicioDia.getTime() - primeira) / passo) * passo;
      for (
        ;
        instante < fimDia.getTime() && instante < ultimo;
        instante += passo
      ) {
        const prevista = new Date(instante);
        const dada = t.doseRegistrada.find(
          (d) => d.previstaPara.getTime() === instante,
        );
        itensPorPet.get(t.registroClinico.petId)?.push({
          tipo: 'REMEDIO',
          id: t.id,
          titulo: t.medicamento,
          detalhe: `${t.dosagem} · ${t.viaAdministracao}`,
          horario: hora(prevista),
          previstaPara: prevista.toISOString(),
          feito: !!dada,
          feitoPor: primeiroNome(dada?.feitoPor.tutor?.nome),
          feitoEm: dada?.feitoEm.toISOString() ?? null,
        });
      }
    }

    // Vacinas: a dose mais nova de cada vacina decide; atrasadas (até 1 ano) ou nos próximos 30 dias.
    const vistas = new Set<string>();
    const limite = new Date(`${somarDias(data, 30)}T00:00:00Z`);
    const antigo = new Date(`${somarDias(data, -365)}T00:00:00Z`);
    const vacinas: {
      petId: string;
      vacina: string;
      proximaDose: string;
      atrasada: boolean;
    }[] = [];
    for (const v of doses) {
      const chave = `${v.registroClinico.petId}|${v.nomeVacina.toLowerCase()}`;
      if (vistas.has(chave)) continue;
      vistas.add(chave);
      if (
        !v.dataProximaDose ||
        v.dataProximaDose > limite ||
        v.dataProximaDose < antigo
      )
        continue;
      const proxima = v.dataProximaDose.toISOString().slice(0, 10);
      vacinas.push({
        petId: v.registroClinico.petId,
        vacina: v.nomeVacina,
        proximaDose: proxima,
        atrasada: proxima < data,
      });
    }

    return {
      data,
      pets: pets.map((p) => ({
        id: p.id,
        nome: p.nome,
        especie: p.raca.especie.nome,
        fotoUrl: p.fotoUrl,
        itens: (itensPorPet.get(p.id) ?? []).sort((a, b) =>
          (a.horario ?? '99').localeCompare(b.horario ?? '99'),
        ),
      })),
      agendamentos: agendamentos.map((a) => ({
        id: a.id,
        petId: a.petId,
        petNome: a.pet.nome,
        servicoNome: a.servico.nome,
        empresaNome: a.servico.empresa.nomeFantasia,
        inicio: a.dataHoraInicio.toISOString(),
        confirmado: a.confirmadoEm !== null,
      })),
      vacinas: vacinas.sort((a, b) =>
        a.proximaDose.localeCompare(b.proximaDose),
      ),
    };
  }

  /** "Dei": registra a dose do remédio e quem deu. */
  async registrarDose(
    usuario: UsuarioAutenticado,
    tratamentoId: string,
    previstaPara: string,
  ) {
    const t = await this.prisma.tratamentoMedicamentoso.findUnique({
      where: { id: tratamentoId },
      include: { registroClinico: { select: { petId: true } } },
    });
    if (!t) throw Erros.naoEncontrado('Tratamento não encontrado');
    const nivel = await this.politicaPet.nivel(
      usuario,
      t.registroClinico.petId,
    );
    if (nivel !== 'RESPONSAVEL_PRINCIPAL' && nivel !== 'RESPONSAVEL') {
      throw Erros.naoEncontrado('Tratamento não encontrado');
    }
    const quando = new Date(previstaPara);
    if (Number.isNaN(quando.getTime())) {
      throw Erros.dadosInvalidos('previstaPara', 'Informe o horário da dose.');
    }
    const dose = await this.prisma.doseRegistrada.upsert({
      where: {
        tratamentoId_previstaPara: { tratamentoId, previstaPara: quando },
      },
      create: { tratamentoId, previstaPara: quando, feitoPorId: usuario.sub },
      update: {},
    });
    return {
      tratamentoId,
      previstaPara: dose.previstaPara.toISOString(),
      feitoEm: dose.feitoEm.toISOString(),
    };
  }

  /** Desfaz a dose marcada por engano. */
  async desfazerDose(
    usuario: UsuarioAutenticado,
    tratamentoId: string,
    previstaPara: string,
  ) {
    const t = await this.prisma.tratamentoMedicamentoso.findUnique({
      where: { id: tratamentoId },
      include: { registroClinico: { select: { petId: true } } },
    });
    if (!t) throw Erros.naoEncontrado('Tratamento não encontrado');
    const nivel = await this.politicaPet.nivel(
      usuario,
      t.registroClinico.petId,
    );
    if (nivel !== 'RESPONSAVEL_PRINCIPAL' && nivel !== 'RESPONSAVEL') {
      throw Erros.naoEncontrado('Tratamento não encontrado');
    }
    await this.prisma.doseRegistrada.deleteMany({
      where: { tratamentoId, previstaPara: new Date(previstaPara) },
    });
  }
}
