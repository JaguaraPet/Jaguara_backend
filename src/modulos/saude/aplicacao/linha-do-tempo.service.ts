import { Injectable } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { ordenarLinhaDoTempo } from '../dominio/linha-do-tempo';
import type { ItemLinhaDoTempo } from '../dominio/linha-do-tempo';
import { PoliticaSaude } from './politica-saude';

/**
 * Linha do tempo do pet (UC-35): vacinas, exames, tratamentos, compromissos e atendimentos
 * em ordem cronológica. A empresa só vê com o escopo LINHA_DO_TEMPO (RN26, CT-35-02).
 */
@Injectable()
export class LinhaDoTempoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly politica: PoliticaSaude,
  ) {}

  async consultar(
    usuario: UsuarioAutenticado,
    petId: string,
  ): Promise<ItemLinhaDoTempo[]> {
    await this.politica.garantir(usuario, petId, 'LINHA_DO_TEMPO', 'ler');
    const clinico = { petId, valido: true };
    const [vacinas, exames, tratamentos, eventos, atendimentos] =
      await Promise.all([
        this.prisma.vacinacao.findMany({
          where: { registroClinico: clinico },
          select: { id: true, nomeVacina: true, dataAplicacao: true },
        }),
        this.prisma.exame.findMany({
          where: { registroClinico: clinico },
          select: { id: true, tipoExame: true, dataRealizacao: true },
        }),
        this.prisma.tratamentoMedicamentoso.findMany({
          where: { registroClinico: clinico },
          select: { id: true, medicamento: true, dataInicio: true },
        }),
        this.prisma.eventoCalendario.findMany({
          where: { petId },
          select: { id: true, titulo: true, dataHoraInicio: true },
        }),
        this.prisma.atendimento.findMany({
          where: { petId, status: 'FINALIZADO' },
          select: {
            id: true,
            finalizadoEm: true,
            dataHoraInicio: true,
            agendamento: {
              select: {
                servico: {
                  select: {
                    nome: true,
                    empresa: { select: { nomeFantasia: true } },
                  },
                },
              },
            },
          },
        }),
      ]);

    return ordenarLinhaDoTempo([
      ...vacinas.map((v) => ({
        data: v.dataAplicacao.toISOString(),
        tipo: 'VACINACAO' as const,
        titulo: `Vacina ${v.nomeVacina}`,
        referenciaId: v.id,
      })),
      ...exames.map((e) => ({
        data: e.dataRealizacao.toISOString(),
        tipo: 'EXAME' as const,
        titulo: `Exame: ${e.tipoExame}`,
        referenciaId: e.id,
      })),
      ...tratamentos.map((t) => ({
        data: t.dataInicio.toISOString(),
        tipo: 'TRATAMENTO' as const,
        titulo: `Início do tratamento: ${t.medicamento}`,
        referenciaId: t.id,
      })),
      ...eventos.map((e) => ({
        data: e.dataHoraInicio.toISOString(),
        tipo: 'EVENTO' as const,
        titulo: e.titulo,
        referenciaId: e.id,
      })),
      ...atendimentos.map((a) => {
        const servico = a.agendamento?.servico;
        return {
          data: (a.finalizadoEm ?? a.dataHoraInicio).toISOString(),
          tipo: 'ATENDIMENTO' as const,
          titulo: servico
            ? `${servico.nome} em ${servico.empresa.nomeFantasia}`
            : 'Atendimento',
          referenciaId: a.id,
        };
      }),
    ]);
  }
}
