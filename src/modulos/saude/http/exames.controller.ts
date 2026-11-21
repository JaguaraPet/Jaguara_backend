import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Autenticado } from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Exame, ExamesService } from '../aplicacao/exames.service';

export class ExameEntradaDto {
  @IsString({ message: 'Informe o exame' })
  @IsNotEmpty({ message: 'Informe o exame' })
  @MaxLength(255)
  tipoExame: string;

  @IsDateString(
    { strict: true },
    { message: 'Informe a data do exame (AAAA-MM-DD)' },
  )
  dataRealizacao: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  laboratorio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  resultado?: string;

  /** Laudo já enviado como documento do pet (UC-34). */
  @IsOptional()
  @IsUUID('all', { message: 'Escolha o documento do laudo' })
  documentoId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  observacoes?: string;
}

/** Exames do pet: tutor responsável ou empresa com o escopo EXAMES (RN15). */
@Autenticado()
@Controller('pets/:petId/exames')
export class ExamesController {
  constructor(private readonly exames: ExamesService) {}

  @Get()
  listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
  ): Promise<Exame[]> {
    return this.exames.listar(usuario, petId);
  }

  @Post()
  registrar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
    @Body() dto: ExameEntradaDto,
  ): Promise<Exame> {
    return this.exames.registrar(usuario, petId, dto);
  }
}
