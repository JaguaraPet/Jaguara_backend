import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  Permissoes,
  SomenteTutor,
} from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Evento, EventosService } from '../aplicacao/eventos.service';
import type { TipoEvento } from '../dominio/evento';

const TIPOS: TipoEvento[] = [
  'CONSULTA',
  'VACINA',
  'MEDICAMENTO',
  'EXAME',
  'CIRURGIA',
  'BANHO_TOSA',
  'HOSPEDAGEM',
  'COMPROMISSO',
  'OUTRO',
];

export class EventoEntradaDto {
  @IsString({ message: 'Dê um título ao evento' })
  @IsNotEmpty({ message: 'Dê um título ao evento' })
  @MaxLength(255)
  titulo: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descricao?: string;

  @IsIn(TIPOS, { message: 'Escolha o tipo do evento' })
  tipo: TipoEvento;

  @IsDateString({}, { message: 'Informe a data e a hora' })
  dataHoraInicio: string;

  @IsOptional()
  @IsDateString({}, { message: 'Informe a data e a hora do fim' })
  dataHoraFim?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  local?: string;
}

export class PeriodoDto {
  @IsOptional()
  @IsDateString({}, { message: 'Informe o início do período' })
  de?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Informe o fim do período' })
  ate?: string;
}

/** Calendário do pet: responsáveis com rotina:ler e rotina:editar. */
@SomenteTutor()
@Controller()
export class EventosController {
  constructor(private readonly eventos: EventosService) {}

  @Permissoes('rotina:ler')
  @Get('pets/:petId/eventos')
  listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
    @Query() periodo: PeriodoDto,
  ): Promise<Evento[]> {
    return this.eventos.listar(usuario, petId, periodo);
  }

  @Permissoes('rotina:editar')
  @Post('pets/:petId/eventos')
  criar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
    @Body() dto: EventoEntradaDto,
  ): Promise<Evento> {
    return this.eventos.criar(usuario, petId, dto);
  }

  @Permissoes('rotina:editar')
  @Delete('eventos/:eventoId')
  @HttpCode(204)
  async excluir(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('eventoId', ParseUUIDPipe) eventoId: string,
  ): Promise<void> {
    await this.eventos.excluir(usuario, eventoId);
  }
}
