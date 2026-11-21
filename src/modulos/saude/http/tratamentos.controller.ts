import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { Autenticado } from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import {
  Tratamento,
  TratamentosService,
} from '../aplicacao/tratamentos.service';

const DATA = { strict: true };

export class TratamentoEntradaDto {
  @IsString({ message: 'Informe o medicamento' })
  @IsNotEmpty({ message: 'Informe o medicamento' })
  @MaxLength(255)
  medicamento: string;

  @IsString({ message: 'Informe a dosagem' })
  @IsNotEmpty({ message: 'Informe a dosagem' })
  @MaxLength(255)
  dosagem: string;

  @IsString({ message: 'Informe como o remédio é dado' })
  @IsNotEmpty({ message: 'Informe como o remédio é dado' })
  @MaxLength(255)
  viaAdministracao: string;

  @IsInt({ message: 'Informe o intervalo em horas' })
  @Min(1, { message: 'O intervalo mínimo é 1 hora' })
  intervaloHoras: number;

  @IsDateString(DATA, { message: 'Informe o início (AAAA-MM-DD)' })
  dataInicio: string;

  @IsOptional()
  @IsDateString(DATA, { message: 'Informe o fim (AAAA-MM-DD)' })
  dataFim?: string;

  /** Hora da primeira dose em Brasília (padrão 08:00). */
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'Informe a hora no formato HH:MM',
  })
  horaPrimeiraDose?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  observacoes?: string;
}

/** Tratamentos medicamentosos: tutor responsável ou empresa com o escopo MEDICAMENTOS. */
@Autenticado()
@Controller()
export class TratamentosController {
  constructor(private readonly tratamentos: TratamentosService) {}

  @Get('pets/:petId/tratamentos')
  listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
  ): Promise<Tratamento[]> {
    return this.tratamentos.listar(usuario, petId);
  }

  @Post('pets/:petId/tratamentos')
  cadastrar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
    @Body() dto: TratamentoEntradaDto,
  ): Promise<Tratamento> {
    return this.tratamentos.cadastrar(usuario, petId, dto);
  }

  @Post('tratamentos/:tratamentoId/finalizacao')
  @HttpCode(204)
  async finalizar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('tratamentoId', ParseUUIDPipe) tratamentoId: string,
  ): Promise<void> {
    await this.tratamentos.finalizar(usuario, tratamentoId);
  }
}
