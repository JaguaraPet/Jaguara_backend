import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  Permissoes,
  SomenteAdministrador,
} from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import {
  ContaDetalhe,
  ContaResumo,
  ContasService,
} from '../aplicacao/contas.service';
import type { NovoStatus, StatusConta } from '../dominio/conta-usuario';

const STATUS: StatusConta[] = [
  'PENDENTE_CONFIRMACAO',
  'ATIVA',
  'BLOQUEADA',
  'SUSPENSA',
  'INATIVA',
];

export class FiltroContasDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  busca?: string;

  @IsOptional()
  @IsIn(STATUS)
  status?: StatusConta;
}

export class StatusContaDto {
  @IsIn(['ATIVA', 'BLOQUEADA', 'SUSPENSA'], {
    message: 'Escolha bloquear, suspender ou reativar',
  })
  status: NovoStatus;

  @IsString({ message: 'Informe o motivo' })
  @MinLength(5, { message: 'Explique o motivo em pelo menos 5 caracteres' })
  @MaxLength(500)
  motivo: string;
}

/** Gestão de contas de usuários (UC-28, RN34). */
@SomenteAdministrador()
@Permissoes('admin:usuarios')
@Controller('admin/usuarios')
export class ContasController {
  constructor(private readonly contas: ContasService) {}

  @Get()
  listar(@Query() filtro: FiltroContasDto): Promise<ContaResumo[]> {
    return this.contas.listar(filtro);
  }

  @Get(':usuarioId')
  detalhar(
    @Param('usuarioId', ParseUUIDPipe) usuarioId: string,
  ): Promise<ContaDetalhe> {
    return this.contas.detalhar(usuarioId);
  }

  @Put(':usuarioId/status')
  @HttpCode(204)
  alterarStatus(
    @UsuarioAtual() admin: UsuarioAutenticado,
    @Param('usuarioId', ParseUUIDPipe) usuarioId: string,
    @Body() dto: StatusContaDto,
    @Ip() ip: string,
  ): Promise<void> {
    return this.contas.alterarStatus(admin, usuarioId, dto, ip);
  }
}
