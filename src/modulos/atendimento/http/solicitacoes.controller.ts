import {
  Body,
  Controller,
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
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  Autenticado,
  Permissoes,
  SomenteEnterprise,
  SomenteTutor,
} from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import {
  Agendamento,
  AgendamentosService,
} from '../aplicacao/agendamentos.service';
import {
  Solicitacao,
  SolicitacoesService,
} from '../aplicacao/solicitacoes.service';
import type { StatusSolicitacao } from '../aplicacao/solicitacoes.service';

export class DataDto {
  @IsDateString(
    { strict: true },
    { message: 'Informe a data no formato AAAA-MM-DD' },
  )
  data: string;
}

export class NovaSolicitacaoDto {
  @IsUUID('all', { message: 'Escolha o serviço' })
  servicoId: string;

  @IsUUID('all', { message: 'Escolha o pet' })
  petId: string;

  @IsDateString({}, { message: 'Escolha um horário disponível' })
  dataHoraDesejada: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observacoes?: string;
}

export class AceiteDto {
  @IsOptional()
  @IsUUID('all', { message: 'Escolha o profissional' })
  profissionalId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'Escolha o recurso' })
  recursoId?: string;
}

export class RecusaDto {
  @IsString({ message: 'Explique ao tutor o motivo da recusa' })
  @MinLength(3, { message: 'Explique ao tutor o motivo da recusa' })
  @MaxLength(500)
  motivo: string;
}

export class FiltroSolicitacoesDto {
  @IsOptional()
  @IsIn([
    'PENDENTE',
    'ACEITA',
    'RECUSADA',
    'CANCELADA',
    'CONCLUIDA',
    'ENCERRADA',
  ])
  status?: StatusSolicitacao;
}

@Controller()
export class SolicitacoesController {
  constructor(
    private readonly solicitacoes: SolicitacoesService,
    private readonly agendamentos: AgendamentosService,
  ) {}

  /** RN40: horários livres do serviço no dia. */
  @Autenticado()
  @Get('servicos/:servicoId/horarios-disponiveis')
  horarios(
    @Param('servicoId', ParseUUIDPipe) servicoId: string,
    @Query() query: DataDto,
  ): Promise<string[]> {
    return this.solicitacoes.horariosDisponiveis(
      servicoId,
      query.data.slice(0, 10),
    );
  }

  /** UC-40: o tutor solicita; a empresa confirma ou recusa depois (RN40). */
  @SomenteTutor()
  @Permissoes('solicitacao:criar')
  @Post('solicitacoes')
  solicitar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() dto: NovaSolicitacaoDto,
  ): Promise<Solicitacao> {
    return this.solicitacoes.solicitar(usuario, dto);
  }

  /** UC-42 (tutor) e UC-41 (empresa). */
  @Autenticado()
  @Get('solicitacoes')
  listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Query() filtro: FiltroSolicitacoesDto,
  ): Promise<Solicitacao[]> {
    return this.solicitacoes.listar(usuario, filtro.status);
  }

  /** UC-41, CT-41-01: aceitar cria o agendamento e avisa o tutor (DS-03). */
  @SomenteEnterprise()
  @Permissoes('agenda:editar')
  @Post('solicitacoes/:solicitacaoId/aceite')
  @HttpCode(200)
  aceitar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('solicitacaoId', ParseUUIDPipe) solicitacaoId: string,
    @Body() dto: AceiteDto,
  ): Promise<Agendamento> {
    return this.agendamentos.aceitarSolicitacao(usuario, solicitacaoId, dto);
  }

  /** UC-41, CT-41-02: recusar exige o motivo. */
  @SomenteEnterprise()
  @Permissoes('agenda:editar')
  @Post('solicitacoes/:solicitacaoId/recusa')
  @HttpCode(204)
  async recusar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('solicitacaoId', ParseUUIDPipe) solicitacaoId: string,
    @Body() dto: RecusaDto,
  ): Promise<void> {
    await this.solicitacoes.recusar(usuario, solicitacaoId, dto.motivo);
    await this.agendamentos.avisarResposta(
      solicitacaoId,
      false,
      dto.motivo.trim(),
    );
  }
}
