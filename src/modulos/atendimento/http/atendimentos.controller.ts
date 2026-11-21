import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  Permissoes,
  SomenteEnterprise,
} from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Auditar } from '../../../compartilhado/auditoria/auditoria.interceptor';
import {
  Atendimento,
  AtendimentosService,
} from '../aplicacao/atendimentos.service';

export class ItemAtendimentoDto {
  @IsUUID('all', { message: 'Escolha o serviço do item' })
  servicoId: string;

  @IsInt({ message: 'Informe a quantidade' })
  @Min(1, { message: 'A quantidade mínima é 1' })
  quantidade: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  observacao?: string;
}

export class AtendimentoEntradaDto {
  @IsString()
  @IsNotEmpty({ message: 'Descreva os procedimentos realizados' })
  @MaxLength(4000)
  procedimentosRealizados: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  observacoesClinicas?: string;

  @ValidateNested({ each: true })
  @Type(() => ItemAtendimentoDto)
  @ArrayMinSize(1, { message: 'Inclua pelo menos um serviço' })
  itens: ItemAtendimentoDto[];
}

export class AlteracaoAtendimentoDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  observacoesClinicas?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Descreva os procedimentos realizados' })
  @MaxLength(4000)
  procedimentosRealizados?: string;

  /** RN28: alteração de atendimento finalizado exige justificativa. */
  @IsString({ message: 'Explique o motivo da alteração' })
  @MinLength(10, { message: 'Explique o motivo com pelo menos 10 caracteres' })
  @MaxLength(1000)
  justificativa: string;
}

@SomenteEnterprise()
@Controller()
export class AtendimentosController {
  constructor(private readonly atendimentos: AtendimentosService) {}

  /** UC-23: registra e finaliza o atendimento de um agendamento ocorrido. */
  @Permissoes('atendimento:editar')
  @Auditar({
    acao: 'ATENDIMENTO_REGISTRADO',
    entidade: 'Agendamento',
    nivel: 'INFO',
    parametro: 'agendamentoId',
  })
  @Post('agendamentos/:agendamentoId/atendimento')
  registrar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('agendamentoId', ParseUUIDPipe) agendamentoId: string,
    @Body() dto: AtendimentoEntradaDto,
  ): Promise<Atendimento> {
    return this.atendimentos.registrar(usuario, agendamentoId, dto);
  }

  @Permissoes('atendimento:ler')
  @Get('agendamentos/:agendamentoId/atendimento')
  consultar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('agendamentoId', ParseUUIDPipe) agendamentoId: string,
  ): Promise<Atendimento> {
    return this.atendimentos.doAgendamento(usuario, agendamentoId);
  }

  /** RN28: alteração posterior com justificativa e auditoria CRITICO. */
  @Permissoes('atendimento:editar')
  @Patch('atendimentos/:atendimentoId')
  alterar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('atendimentoId', ParseUUIDPipe) atendimentoId: string,
    @Body() dto: AlteracaoAtendimentoDto,
  ): Promise<Atendimento> {
    return this.atendimentos.alterar(usuario, atendimentoId, dto);
  }
}
