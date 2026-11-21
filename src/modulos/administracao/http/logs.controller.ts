import { Controller, Get, Query } from '@nestjs/common';
import { IsDateString, IsIn, IsOptional } from 'class-validator';
import {
  Permissoes,
  SomenteAdministrador,
} from '../../../compartilhado/auth/permissoes';
import { AuditoriaService } from '../../../compartilhado/auditoria/auditoria.service';
import type { NivelLog } from '../../../compartilhado/auditoria/auditoria.service';

export class FiltroLogsDto {
  @IsOptional()
  @IsIn(['INFO', 'ALERTA', 'CRITICO'])
  nivel?: NivelLog;

  @IsOptional()
  @IsDateString({}, { message: 'Informe a data inicial em ISO 8601' })
  de?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Informe a data final em ISO 8601' })
  ate?: string;
}

/** Monitoramento e logs da plataforma (UC-25, RN31). */
@SomenteAdministrador()
@Controller('admin/logs')
export class LogsController {
  constructor(private readonly auditoria: AuditoriaService) {}

  @Permissoes('admin:auditoria')
  @Get()
  listar(@Query() filtro: FiltroLogsDto) {
    return this.auditoria.listar({
      nivel: filtro.nivel,
      de: filtro.de ? new Date(filtro.de) : undefined,
      ate: filtro.ate ? new Date(filtro.ate) : undefined,
    });
  }
}
