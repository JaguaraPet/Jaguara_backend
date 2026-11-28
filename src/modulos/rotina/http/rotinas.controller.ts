import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  Autenticado,
  SomenteTutor,
} from '../../../compartilhado/auth/permissoes';
import {
  UsuarioAtual,
  type UsuarioAutenticado,
} from '../../../compartilhado/auth/usuario-autenticado';
import { HojeTutorService } from '../aplicacao/hoje-tutor.service';
import { RotinasService } from '../aplicacao/rotinas.service';
import type { FrequenciaRotina, TipoRotina } from '../dominio/rotina';

const TIPOS = [
  'PASSEIO',
  'BANHO',
  'ANTIPULGAS',
  'VERMIFUGO',
  'ESCOVACAO',
  'AREIA',
  'ALIMENTACAO',
  'OUTRO',
];
const FREQUENCIAS = ['DIARIA', 'SEMANAL', 'MENSAL', 'INTERVALO_DIAS'];
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export class RotinaDto {
  @IsString()
  @IsNotEmpty({ message: 'Dê um nome à rotina' })
  @MaxLength(120)
  titulo: string;

  @IsIn(TIPOS)
  tipo: TipoRotina;

  @IsIn(FREQUENCIAS)
  frequencia: FrequenciaRotina;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  intervaloDias?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  diasSemana?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @Matches(HORA, { each: true, message: 'Use horários no formato HH:MM' })
  horarios?: string[];

  @IsOptional()
  @IsDateString()
  dataInicio?: string;
}

export class FeitoDto {
  @IsOptional()
  @IsDateString()
  data?: string;

  @IsOptional()
  @Matches(HORA, { message: 'Use o horário no formato HH:MM' })
  horario?: string;
}

export class DesfazerDto {
  @IsDateString()
  data: string;

  @IsOptional()
  @Matches(HORA)
  horario?: string;
}

export class DoseDto {
  @IsDateString({}, { message: 'Informe o horário previsto da dose' })
  previstaPara: string;
}

/** Criador de rotinas, rotina do dia e doses dadas (app do tutor). */
@SomenteTutor()
@Controller()
export class RotinasController {
  constructor(
    private readonly rotinas: RotinasService,
    private readonly hojeTutor: HojeTutorService,
  ) {}

  @Autenticado()
  @Get('rotinas/modelos')
  modelos() {
    return this.rotinas.modelos();
  }

  @Autenticado()
  @Get('tutor/hoje')
  hoje(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.hojeTutor.hoje(usuario);
  }

  @Autenticado()
  @Get('pets/:petId/rotinas')
  listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
  ) {
    return this.rotinas.listar(usuario, petId);
  }

  @Autenticado()
  @Post('pets/:petId/rotinas')
  criar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
    @Body() dto: RotinaDto,
  ) {
    return this.rotinas.criar(usuario, petId, dto);
  }

  @Autenticado()
  @Patch('rotinas/:rotinaId')
  atualizar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('rotinaId', ParseUUIDPipe) rotinaId: string,
    @Body() dto: RotinaDto,
  ) {
    return this.rotinas.atualizar(usuario, rotinaId, dto);
  }

  @Autenticado()
  @Delete('rotinas/:rotinaId')
  @HttpCode(204)
  async desativar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('rotinaId', ParseUUIDPipe) rotinaId: string,
  ): Promise<void> {
    await this.rotinas.desativar(usuario, rotinaId);
  }

  @Autenticado()
  @Post('rotinas/:rotinaId/feitos')
  marcar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('rotinaId', ParseUUIDPipe) rotinaId: string,
    @Body() dto: FeitoDto,
  ) {
    return this.rotinas.marcar(usuario, rotinaId, dto);
  }

  @Autenticado()
  @Delete('rotinas/:rotinaId/feitos')
  @HttpCode(204)
  async desmarcar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('rotinaId', ParseUUIDPipe) rotinaId: string,
    @Query() dto: DesfazerDto,
  ): Promise<void> {
    await this.rotinas.desmarcar(usuario, rotinaId, dto);
  }

  @Autenticado()
  @Post('tratamentos/:tratamentoId/doses')
  registrarDose(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('tratamentoId', ParseUUIDPipe) tratamentoId: string,
    @Body() dto: DoseDto,
  ) {
    return this.hojeTutor.registrarDose(
      usuario,
      tratamentoId,
      dto.previstaPara,
    );
  }

  @Autenticado()
  @Delete('tratamentos/:tratamentoId/doses')
  @HttpCode(204)
  async desfazerDose(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('tratamentoId', ParseUUIDPipe) tratamentoId: string,
    @Query() dto: DoseDto,
  ): Promise<void> {
    await this.hojeTutor.desfazerDose(usuario, tratamentoId, dto.previstaPara);
  }
}
