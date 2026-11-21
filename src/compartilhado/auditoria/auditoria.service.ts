import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type NivelLog = 'INFO' | 'ALERTA' | 'CRITICO';

export interface RegistroAuditoria {
  acao: string;
  entidade: string;
  entidadeId: string;
  nivel: NivelLog;
  autorId?: string | null;
  ip?: string;
  detalhes?: string;
}

/**
 * Log de auditoria das ações críticas (RN31, ADR-012 passo 6). A gravação nunca derruba a
 * requisição: se falhar, fica só no log da aplicação.
 */
@Injectable()
export class AuditoriaService {
  private readonly logger = new Logger(AuditoriaService.name);

  constructor(private readonly prisma: PrismaService) {}

  async registrar(registro: RegistroAuditoria): Promise<void> {
    try {
      await this.prisma.logAuditoria.create({
        data: {
          dataHora: new Date(),
          acao: registro.acao,
          entidade: registro.entidade,
          entidadeId: registro.entidadeId.slice(0, 255),
          nivel: registro.nivel,
          autorId: registro.autorId ?? null,
          ipOrigem: registro.ip?.slice(0, 255),
          detalhes: registro.detalhes,
        },
      });
    } catch (erro) {
      this.logger.error(
        `Falha ao gravar auditoria de ${registro.acao}: ${String(erro)}`,
      );
    }
  }

  /** Consulta para o monitoramento da administração (UC-25). */
  listar(filtro: { nivel?: NivelLog; de?: Date; ate?: Date; limite?: number }) {
    return this.prisma.logAuditoria.findMany({
      where: {
        ...(filtro.nivel ? { nivel: filtro.nivel } : {}),
        ...(filtro.de || filtro.ate
          ? {
              dataHora: {
                ...(filtro.de ? { gte: filtro.de } : {}),
                ...(filtro.ate ? { lte: filtro.ate } : {}),
              },
            }
          : {}),
      },
      orderBy: { dataHora: 'desc' },
      take: filtro.limite ?? 500,
      select: {
        dataHora: true,
        acao: true,
        entidade: true,
        entidadeId: true,
        nivel: true,
        autorId: true,
        detalhes: true,
      },
    });
  }
}
