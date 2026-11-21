import { Injectable } from '@nestjs/common';
import { garantirMesmaEmpresa } from '../../../compartilhado/auth/escopo-empresa';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import {
  DiaSemana,
  hora,
  horaValida,
  minutos,
  sobrepoe,
} from '../dominio/horarios';

export interface HorarioEntrada {
  diaSemana: DiaSemana;
  horaInicio: string;
  horaFim: string;
  funcionarioId?: string;
  recursoId?: string;
}

export interface Horario extends HorarioEntrada {
  id: string;
}

const paraTime = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00Z`);
const deTime = (d: Date) => hora(d.getUTCHours() * 60 + d.getUTCMinutes());

/** Horários de atuação de profissionais e recursos (UC-24). */
@Injectable()
export class HorariosService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(
    usuario: UsuarioAutenticado,
    empresaId: string,
  ): Promise<Horario[]> {
    garantirMesmaEmpresa(usuario, empresaId);
    const horarios = await this.prisma.horarioAtuacao.findMany({
      where: {
        OR: [{ funcionario: { empresaId } }, { recurso: { empresaId } }],
      },
      orderBy: [{ diaSemana: 'asc' }, { horaInicio: 'asc' }],
    });
    return horarios.map((h) => this.resposta(h));
  }

  /** CT-24-01: registra o horário; recusa sobreposição com outro horário do mesmo dono (RN29). */
  async criar(
    usuario: UsuarioAutenticado,
    empresaId: string,
    dados: HorarioEntrada,
  ): Promise<Horario> {
    garantirMesmaEmpresa(usuario, empresaId);
    if (!!dados.funcionarioId === !!dados.recursoId) {
      throw Erros.dadosInvalidos(
        'funcionarioId',
        'Informe o profissional ou o recurso, só um dos dois (RC-20).',
      );
    }
    if (
      !horaValida(dados.horaInicio) ||
      !horaValida(dados.horaFim) ||
      minutos(dados.horaInicio) >= minutos(dados.horaFim)
    ) {
      throw Erros.dadosInvalidos(
        'horaFim',
        'O horário final precisa ser depois do inicial.',
      );
    }
    if (dados.funcionarioId) {
      const funcionario = await this.prisma.funcionarioEnterprise.findUnique({
        where: { id: dados.funcionarioId },
      });
      if (
        !funcionario ||
        funcionario.empresaId !== empresaId ||
        !funcionario.ativo
      ) {
        throw Erros.dadosInvalidos(
          'funcionarioId',
          'Escolha um profissional ativo da sua empresa.',
        );
      }
    } else {
      const recurso = await this.prisma.recurso.findUnique({
        where: { id: dados.recursoId },
      });
      if (!recurso || recurso.empresaId !== empresaId || !recurso.ativo) {
        throw Erros.dadosInvalidos(
          'recursoId',
          'Escolha um recurso ativo da sua empresa.',
        );
      }
    }
    const existentes = await this.prisma.horarioAtuacao.findMany({
      where: {
        diaSemana: dados.diaSemana,
        ...(dados.funcionarioId
          ? { funcionarioId: dados.funcionarioId }
          : { recursoId: dados.recursoId }),
      },
    });
    const novo = {
      inicio: minutos(dados.horaInicio),
      fim: minutos(dados.horaFim),
    };
    const conflito = existentes.some((h) =>
      sobrepoe(novo, {
        inicio: minutos(deTime(h.horaInicio)),
        fim: minutos(deTime(h.horaFim)),
      }),
    );
    if (conflito) {
      throw Erros.conflito(
        'HORARIO_SOBREPOSTO',
        'Já existe um horário de atuação neste intervalo.',
      );
    }
    const criado = await this.prisma.horarioAtuacao.create({
      data: {
        diaSemana: dados.diaSemana,
        horaInicio: paraTime(dados.horaInicio),
        horaFim: paraTime(dados.horaFim),
        funcionarioId: dados.funcionarioId,
        recursoId: dados.recursoId,
      },
    });
    return this.resposta(criado);
  }

  async remover(usuario: UsuarioAutenticado, horarioId: string): Promise<void> {
    const horario = await this.prisma.horarioAtuacao.findUnique({
      where: { id: horarioId },
      include: { funcionario: true, recurso: true },
    });
    if (!horario) throw Erros.naoEncontrado('Horário não encontrado');
    garantirMesmaEmpresa(
      usuario,
      horario.funcionario?.empresaId ?? horario.recurso!.empresaId,
    );
    await this.prisma.horarioAtuacao.delete({ where: { id: horarioId } });
  }

  private resposta(h: {
    id: string;
    diaSemana: DiaSemana;
    horaInicio: Date;
    horaFim: Date;
    funcionarioId: string | null;
    recursoId: string | null;
  }): Horario {
    return {
      id: h.id,
      diaSemana: h.diaSemana,
      horaInicio: deTime(h.horaInicio),
      horaFim: deTime(h.horaFim),
      ...(h.funcionarioId ? { funcionarioId: h.funcionarioId } : {}),
      ...(h.recursoId ? { recursoId: h.recursoId } : {}),
    };
  }
}
