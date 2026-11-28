import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  Permissoes,
  SomenteEnterprise,
  SomenteTutor,
} from '../../../compartilhado/auth/permissoes';
import {
  UsuarioAtual,
  type UsuarioAutenticado,
} from '../../../compartilhado/auth/usuario-autenticado';
import { AvaliacoesService } from '../aplicacao/avaliacoes.service';

export class AvaliacaoDto {
  @Type(() => Number)
  @IsInt({ message: 'Dê uma nota de 1 a 5' })
  @Min(1, { message: 'Dê uma nota de 1 a 5' })
  @Max(5, { message: 'Dê uma nota de 1 a 5' })
  nota: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Use até 1000 caracteres' })
  comentario?: string;
}

export class RespostaAvaliacaoDto {
  @IsString()
  @MaxLength(1000, { message: 'Use até 1000 caracteres' })
  resposta: string;
}

export class PaginaAvaliacoesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  tamanho = 20;
}

/** Avaliação depois do atendimento: o tutor avalia, a empresa acompanha e responde. */
@Controller()
export class AvaliacoesController {
  constructor(private readonly avaliacoes: AvaliacoesService) {}

  @SomenteTutor()
  @Permissoes('solicitacao:criar')
  @Post('agendamentos/:agendamentoId/avaliacao')
  avaliar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('agendamentoId', ParseUUIDPipe) agendamentoId: string,
    @Body() dados: AvaliacaoDto,
  ) {
    return this.avaliacoes.avaliar(usuario, agendamentoId, dados);
  }

  @SomenteTutor()
  @Permissoes('solicitacao:criar')
  @Get('tutor/avaliacoes/pendentes')
  pendentes(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.avaliacoes.pendentes(usuario);
  }

  @SomenteEnterprise()
  @Permissoes('atendimento:ler')
  @Get('empresas/:empresaId/avaliacoes')
  daEmpresa(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
    @Query() pagina: PaginaAvaliacoesDto,
  ) {
    return this.avaliacoes.daEmpresa(
      usuario,
      empresaId,
      pagina.pagina,
      pagina.tamanho,
    );
  }

  @SomenteEnterprise()
  @Permissoes('empresa:editar')
  @Put('empresas/:empresaId/avaliacoes/:avaliacaoId/resposta')
  responder(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
    @Param('avaliacaoId', ParseUUIDPipe) avaliacaoId: string,
    @Body() dados: RespostaAvaliacaoDto,
  ) {
    return this.avaliacoes.responder(
      usuario,
      empresaId,
      avaliacaoId,
      dados.resposta,
    );
  }
}
