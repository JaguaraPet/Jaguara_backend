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
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Autenticado } from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Auditar } from '../../../compartilhado/auditoria/auditoria.interceptor';
import { Documento, DocumentosService } from '../aplicacao/documentos.service';
import { TIPOS_DOCUMENTO } from '../dominio/documento';
import type { TipoDocumento } from '../dominio/documento';

export class NovoDocumentoDto {
  @IsString({ message: 'Dê um título ao documento' })
  @IsNotEmpty({ message: 'Dê um título ao documento' })
  @MaxLength(255)
  titulo: string;

  @IsIn(TIPOS_DOCUMENTO, { message: 'Escolha o tipo do documento' })
  tipo: TipoDocumento;

  @IsString({ message: 'Informe o nome do arquivo' })
  @IsNotEmpty({ message: 'Informe o nome do arquivo' })
  @MaxLength(255)
  nomeArquivo: string;

  @IsInt({ message: 'Informe o tamanho do arquivo' })
  @Min(1, { message: 'O arquivo está vazio.' })
  tamanhoBytes: number;

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'Informe a data (AAAA-MM-DD)' })
  dataEmissao?: string;

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'Informe a data (AAAA-MM-DD)' })
  dataValidade?: string;
}

/** Documentos do pet: tutor responsável ou empresa com o escopo DOCUMENTOS (UC-34, RN15). */
@Autenticado()
@Controller()
export class DocumentosController {
  constructor(private readonly documentos: DocumentosService) {}

  @Get('pets/:petId/documentos')
  listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
  ): Promise<Documento[]> {
    return this.documentos.listar(usuario, petId);
  }

  @Post('pets/:petId/documentos')
  iniciarEnvio(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
    @Body() dto: NovoDocumentoDto,
  ) {
    return this.documentos.iniciarEnvio(usuario, petId, dto);
  }

  @Get('documentos/:documentoId/download')
  download(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
  ) {
    return this.documentos.download(usuario, documentoId);
  }

  @Auditar({
    acao: 'DOCUMENTO_EXCLUIDO',
    entidade: 'DocumentoPet',
    nivel: 'ALERTA',
    parametro: 'documentoId',
  })
  @Delete('documentos/:documentoId')
  @HttpCode(204)
  async excluir(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('documentoId', ParseUUIDPipe) documentoId: string,
  ): Promise<void> {
    await this.documentos.excluir(usuario, documentoId);
  }
}
