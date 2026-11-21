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
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  Permissoes,
  SomenteTutor,
} from '../../../compartilhado/auth/permissoes';
import {
  Publica,
  UsuarioAtual,
} from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Auditar } from '../../../compartilhado/auditoria/auditoria.interceptor';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import {
  Compartilhamento,
  CompartilhamentosService,
} from '../aplicacao/compartilhamentos.service';
import { ROTULO_ESCOPO, SECOES } from '../dominio/compartilhamento';
import type { Escopo, Secao } from '../dominio/compartilhamento';

export class CompartilhamentoEntradaDto {
  @IsOptional()
  @IsUUID('all', { message: 'Escolha a empresa' })
  empresaId?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Informe um e-mail válido' })
  @MaxLength(255)
  destinatarioEmail?: string;

  @IsArray({ message: 'Escolha o que compartilhar' })
  @ArrayMinSize(1, { message: 'Escolha pelo menos uma informação' })
  @IsIn(Object.keys(ROTULO_ESCOPO), {
    each: true,
    message: 'Escolha informações válidas',
  })
  escopos: Escopo[];

  @IsOptional()
  @IsDateString({}, { message: 'Informe a data e a hora da expiração' })
  dataExpiracao?: string;
}

@Controller()
export class CompartilhamentosController {
  constructor(private readonly compartilhamentos: CompartilhamentosService) {}

  @SomenteTutor()
  @Permissoes('compartilhamento:gerenciar')
  @Get('pets/:petId/compartilhamentos')
  listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
  ): Promise<Compartilhamento[]> {
    return this.compartilhamentos.listar(usuario, petId);
  }

  /** UC-11: compartilha os escopos escolhidos com uma empresa ou um e-mail (RN15). */
  @SomenteTutor()
  @Permissoes('compartilhamento:gerenciar')
  @Auditar({
    acao: 'PET_COMPARTILHADO',
    entidade: 'Pet',
    nivel: 'INFO',
    parametro: 'petId',
  })
  @Post('pets/:petId/compartilhamentos')
  compartilhar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
    @Body() dto: CompartilhamentoEntradaDto,
  ): Promise<Compartilhamento> {
    return this.compartilhamentos.compartilhar(usuario, petId, dto);
  }

  @SomenteTutor()
  @Permissoes('compartilhamento:gerenciar')
  @Auditar({
    acao: 'COMPARTILHAMENTO_REVOGADO',
    entidade: 'CompartilhamentoPet',
    nivel: 'INFO',
    parametro: 'compartilhamentoId',
  })
  @Post('compartilhamentos/:compartilhamentoId/revogacao')
  @HttpCode(204)
  async revogar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('compartilhamentoId', ParseUUIDPipe) compartilhamentoId: string,
  ): Promise<void> {
    await this.compartilhamentos.revogar(usuario, compartilhamentoId);
  }

  /** Link público do compartilhamento por e-mail, sem conta. */
  @Publica()
  @Get('compartilhados/:token')
  ver(@Param('token') token: string) {
    return this.compartilhamentos.verPorLink(token);
  }

  @Publica()
  @Get('compartilhados/:token/:secao')
  secao(@Param('token') token: string, @Param('secao') secao: string) {
    if (!Object.hasOwn(SECOES, secao))
      throw Erros.naoEncontrado('Seção não encontrada');
    return this.compartilhamentos.secaoPorLink(token, secao as Secao);
  }
}
