import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  ParseArrayPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  Autenticado,
  Permissoes,
} from '../../../compartilhado/auth/permissoes';
import {
  Publica,
  UsuarioAtual,
} from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import {
  PrivacidadeService,
  SituacaoConsentimento,
  Termo,
} from '../aplicacao/privacidade.service';
import type { TipoSolicitacao } from '../aplicacao/privacidade.service';

export class AlteracaoConsentimentoDto {
  @IsUUID('all', { message: 'Escolha o termo' })
  termoId: string;

  @IsBoolean({ message: 'Informe se aceita' })
  aceito: boolean;
}

export class SolicitacaoDto {
  @IsIn(['EXPORTACAO_DADOS', 'EXCLUSAO_DADOS', 'CORRECAO_DADOS'], {
    message: 'Escolha o tipo de solicitação',
  })
  tipo: TipoSolicitacao;

  /** Obrigatória para a exclusão (UC-46, FA2). */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  senha?: string;
}

@Controller()
export class PrivacidadeController {
  constructor(private readonly privacidade: PrivacidadeService) {}

  /** RN42: versões vigentes, também antes do login (cadastro). */
  @Publica()
  @Get('termos/vigentes')
  termos(): Promise<Termo[]> {
    return this.privacidade.termosVigentes();
  }

  @Autenticado()
  @Get('privacidade/consentimentos')
  consentimentos(
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<SituacaoConsentimento[]> {
    return this.privacidade.consentimentos(usuario);
  }

  @Autenticado()
  @Put('privacidade/consentimentos')
  @HttpCode(204)
  async atualizar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body(new ParseArrayPipe({ items: AlteracaoConsentimentoDto }))
    alteracoes: AlteracaoConsentimentoDto[],
    @Ip() ip: string,
  ): Promise<void> {
    await this.privacidade.atualizar(usuario, alteracoes, ip);
  }

  /** Direitos do titular: exportação, exclusão e correção (LGPD art. 18). */
  @Permissoes('privacidade:solicitar')
  @Post('privacidade/solicitacoes')
  @HttpCode(202)
  solicitar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() dto: SolicitacaoDto,
    @Ip() ip: string,
  ) {
    return this.privacidade.solicitar(usuario, dto.tipo, dto.senha, ip);
  }

  @Permissoes('privacidade:solicitar')
  @Get('privacidade/exportacao')
  exportar(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.privacidade.exportar(usuario);
  }
}
