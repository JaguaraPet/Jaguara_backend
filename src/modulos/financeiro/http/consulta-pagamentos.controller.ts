import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Autenticado } from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import {
  ConsultaPagamentosService,
  PagamentoDetalhado,
} from '../aplicacao/consulta-pagamentos.service';

const DATA = { strict: true };

export class FiltroPagamentosDto {
  @IsOptional()
  @IsIn(['PENDENTE', 'ACEITO', 'CANCELADO', 'RECUSADO'])
  status?: string;

  @IsOptional()
  @IsDateString(DATA, { message: 'Informe a data inicial (AAAA-MM-DD)' })
  de?: string;

  @IsOptional()
  @IsDateString(DATA, { message: 'Informe a data final (AAAA-MM-DD)' })
  ate?: string;
}

export class ReembolsoDto {
  @IsString({ message: 'Conte o motivo do reembolso' })
  @MaxLength(1000)
  motivo: string;
}

/** Pagamentos realizados e recebidos (UC-45): o serviço confere tutor ou empresa (RN22). */
@Autenticado()
@Controller('pagamentos')
export class ConsultaPagamentosController {
  constructor(private readonly consulta: ConsultaPagamentosService) {}

  @Get()
  listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Query() filtro: FiltroPagamentosDto,
  ): Promise<PagamentoDetalhado[]> {
    return this.consulta.listar(usuario, filtro);
  }

  @Get(':pagamentoId')
  detalhar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('pagamentoId', ParseUUIDPipe) pagamentoId: string,
  ): Promise<PagamentoDetalhado> {
    return this.consulta.detalhar(usuario, pagamentoId);
  }

  @Post(':pagamentoId/reembolsos')
  reembolsar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('pagamentoId', ParseUUIDPipe) pagamentoId: string,
    @Body() dto: ReembolsoDto,
  ): Promise<PagamentoDetalhado> {
    return this.consulta.solicitarReembolso(usuario, pagamentoId, dto.motivo);
  }
}
