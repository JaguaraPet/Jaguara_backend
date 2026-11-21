import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
import {
  Permissoes,
  SomenteEnterprise,
} from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Horario, HorariosService } from '../aplicacao/horarios.service';
import type { DiaSemana } from '../dominio/horarios';

const HORA = /^[0-2][0-9]:[0-5][0-9]$/;

export class HorarioEntradaDto {
  @IsIn(
    ['SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO', 'DOMINGO'],
    {
      message: 'Escolha o dia da semana',
    },
  )
  diaSemana: DiaSemana;

  @Matches(HORA, { message: 'Informe a hora no formato HH:MM' })
  horaInicio: string;

  @Matches(HORA, { message: 'Informe a hora no formato HH:MM' })
  horaFim: string;

  @IsOptional()
  @IsUUID()
  funcionarioId?: string;

  @IsOptional()
  @IsUUID()
  recursoId?: string;
}

/** Horários de atuação (UC-24). */
@SomenteEnterprise()
@Controller()
export class HorariosController {
  constructor(private readonly horarios: HorariosService) {}

  @Permissoes('agenda:ler')
  @Get('empresas/:empresaId/horarios-atuacao')
  listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
  ): Promise<Horario[]> {
    return this.horarios.listar(usuario, empresaId);
  }

  @Permissoes('recurso:editar')
  @Post('empresas/:empresaId/horarios-atuacao')
  criar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
    @Body() dto: HorarioEntradaDto,
  ): Promise<Horario> {
    return this.horarios.criar(usuario, empresaId, dto);
  }

  @Permissoes('recurso:editar')
  @Delete('horarios-atuacao/:horarioId')
  @HttpCode(204)
  async remover(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('horarioId', ParseUUIDPipe) horarioId: string,
  ): Promise<void> {
    await this.horarios.remover(usuario, horarioId);
  }
}
