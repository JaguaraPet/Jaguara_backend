import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';
import {
  Autenticado,
  Permissoes,
  SomenteEnterprise,
  SomenteTutor,
} from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Auditar } from '../../../compartilhado/auditoria/auditoria.interceptor';
import {
  Agendamento,
  AgendamentosService,
} from '../aplicacao/agendamentos.service';

export class AgendamentoEntradaDto {
  @IsUUID('all', { message: 'Escolha o serviço' })
  servicoId: string;

  @IsUUID('all', { message: 'Escolha o pet' })
  petId: string;

  @IsDateString({}, { message: 'Informe a data e a hora' })
  dataHoraInicio: string;

  @IsOptional()
  @IsUUID()
  profissionalId?: string;

  @IsOptional()
  @IsUUID()
  recursoId?: string;
}

export class RemarcacaoDto {
  @IsDateString({}, { message: 'Informe o novo início' })
  dataHoraInicio: string;

  @IsDateString({}, { message: 'Informe o novo fim' })
  dataHoraFim: string;

  @IsOptional()
  @IsUUID()
  profissionalId?: string;

  @IsOptional()
  @IsUUID()
  recursoId?: string;
}

export class SemanaDto {
  @IsDateString(
    { strict: true },
    { message: 'Informe a semana no formato AAAA-MM-DD' },
  )
  semana: string;

  @IsOptional()
  @IsUUID()
  profissionalId?: string;

  @IsOptional()
  @IsUUID()
  recursoId?: string;
}

@Controller()
export class AgendamentosController {
  constructor(private readonly agendamentos: AgendamentosService) {}

  /** UC-39: a empresa agenda direto para o pet de um cliente ou compartilhado. */
  @SomenteEnterprise()
  @Permissoes('agenda:editar')
  @Post('agendamentos')
  criar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() dto: AgendamentoEntradaDto,
  ): Promise<Agendamento> {
    return this.agendamentos.criar(usuario, dto);
  }

  /** UC-24: remarca sem conflito (RN29). */
  @SomenteEnterprise()
  @Permissoes('agenda:editar')
  @Auditar({
    acao: 'AGENDAMENTO_REMARCADO',
    entidade: 'Agendamento',
    nivel: 'INFO',
    parametro: 'agendamentoId',
  })
  @Patch('agendamentos/:agendamentoId')
  remarcar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('agendamentoId', ParseUUIDPipe) agendamentoId: string,
    @Body() dto: RemarcacaoDto,
  ): Promise<Agendamento> {
    return this.agendamentos.remarcar(usuario, agendamentoId, dto);
  }

  @Autenticado()
  @Auditar({
    acao: 'AGENDAMENTO_CANCELADO',
    entidade: 'Agendamento',
    nivel: 'INFO',
    parametro: 'agendamentoId',
  })
  @Post('agendamentos/:agendamentoId/cancelamento')
  @HttpCode(204)
  async cancelar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('agendamentoId', ParseUUIDPipe) agendamentoId: string,
  ): Promise<void> {
    await this.agendamentos.cancelar(usuario, agendamentoId);
  }

  /** O tutor confirma, pelo lembrete, que vai ao agendamento. */
  @SomenteTutor()
  @Autenticado()
  @Post('agendamentos/:agendamentoId/confirmacao')
  confirmarPresenca(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('agendamentoId', ParseUUIDPipe) agendamentoId: string,
  ): Promise<Agendamento> {
    return this.agendamentos.confirmarPresenca(usuario, agendamentoId);
  }

  /** UC-24: agenda semanal com os pedidos pendentes. */
  @SomenteEnterprise()
  @Permissoes('agenda:ler')
  @Get('empresas/:empresaId/agenda')
  agenda(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
    @Query() filtro: SemanaDto,
  ) {
    return this.agendamentos.agenda(usuario, empresaId, filtro);
  }
}
