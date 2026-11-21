import { Injectable } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import type { NivelAcessoPet } from '../dominio/pet';

/**
 * Política de acesso aos dados do pet (ADR-012, passo 5; RN15, RN24, RN26). Só faz a consulta
 * que a regra exige:
 * - tutor: responsável ativo; o principal pode arquivar e excluir;
 * - empresa e funcionários: compartilhamento ativo com a empresa, agendamento com ela ou pet de
 *   cliente sem conta da própria empresa.
 */
@Injectable()
export class PoliticaAcessoPet {
  constructor(private readonly prisma: PrismaService) {}

  async nivel(
    usuario: UsuarioAutenticado,
    petId: string,
  ): Promise<NivelAcessoPet> {
    if (usuario.tipo === 'TUTOR') {
      const responsavel = await this.prisma.responsavelPet.findFirst({
        where: { petId, tutorId: usuario.sub, ativo: true },
        select: { tipo: true },
      });
      if (!responsavel) return 'NENHUM';
      return responsavel.tipo === 'PRINCIPAL'
        ? 'RESPONSAVEL_PRINCIPAL'
        : 'RESPONSAVEL';
    }
    if (usuario.empresaId) {
      const agora = new Date();
      const [compartilhado, agendado, cliente] = await Promise.all([
        this.prisma.compartilhamentoPet.count({
          where: {
            petId,
            empresaId: usuario.empresaId,
            status: 'ATIVO',
            OR: [{ dataExpiracao: null }, { dataExpiracao: { gt: agora } }],
          },
        }),
        this.prisma.agendamento.count({
          where: { petId, servico: { empresaId: usuario.empresaId } },
        }),
        this.prisma.clientePet.count({
          where: {
            petId,
            cliente: { empresaId: usuario.empresaId, ativo: true },
          },
        }),
      ]);
      return compartilhado + agendado + cliente > 0 ? 'EMPRESA' : 'NENHUM';
    }
    return 'NENHUM';
  }

  /** Pet de cliente sem conta cadastrado pela empresa (ADR-010): a empresa pode editar. */
  async petDeClienteSemConta(
    empresaId: string,
    petId: string,
  ): Promise<boolean> {
    const total = await this.prisma.clientePet.count({
      where: { petId, cliente: { empresaId, ativo: true, tutorId: null } },
    });
    return total > 0;
  }
}
