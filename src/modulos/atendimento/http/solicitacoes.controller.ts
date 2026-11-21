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
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  Autenticado,
  Permissoes,
  SomenteTutor,
} from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
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
  constructor(private readonly solicitacoes: SolicitacoesService) {}

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
}
