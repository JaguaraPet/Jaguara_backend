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
} from '@nestjs/common';
import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Autenticado } from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Auditar } from '../../../compartilhado/auditoria/auditoria.interceptor';
import { Alergia, AlergiasService } from '../aplicacao/alergias.service';
import type { Gravidade, TipoAlergia } from '../dominio/alergia';

const TIPOS: TipoAlergia[] = [
  'ALERGIA',
  'RESTRICAO_ALIMENTAR',
  'RESTRICAO_MEDICAMENTOSA',
  'OUTRA',
];
const GRAVIDADES: Gravidade[] = ['LEVE', 'MODERADA', 'GRAVE'];

export class AlergiaDto {
  @IsIn(TIPOS, { message: 'Escolha o tipo' })
  tipo: TipoAlergia;

  @IsString({ message: 'Descreva a alergia ou restrição' })
  @IsNotEmpty({ message: 'Descreva a alergia ou restrição' })
  @MaxLength(500)
  descricao: string;

  @IsIn(GRAVIDADES, { message: 'Escolha a gravidade' })
  gravidade: Gravidade;

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'Informe a data (AAAA-MM-DD)' })
  dataIdentificacao?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  observacoes?: string;
}

export class AlteracaoAlergiaDto {
  @IsOptional()
  @IsIn(TIPOS, { message: 'Escolha o tipo' })
  tipo?: TipoAlergia;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Descreva a alergia ou restrição' })
  @MaxLength(500)
  descricao?: string;

  @IsOptional()
  @IsIn(GRAVIDADES, { message: 'Escolha a gravidade' })
  gravidade?: Gravidade;

  @IsOptional()
  @IsDateString({ strict: true }, { message: 'Informe a data (AAAA-MM-DD)' })
  dataIdentificacao?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  observacoes?: string;
}

/** Alergias e restrições: tutor responsável ou empresa com o escopo ALERGIAS (RN15, RN30). */
@Autenticado()
@Controller()
export class AlergiasController {
  constructor(private readonly alergias: AlergiasService) {}

  @Get('pets/:petId/alergias')
  listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
  ): Promise<Alergia[]> {
    return this.alergias.listar(usuario, petId);
  }

  @Post('pets/:petId/alergias')
  registrar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
    @Body() dto: AlergiaDto,
  ): Promise<Alergia> {
    return this.alergias.registrar(usuario, petId, dto);
  }

  @Patch('alergias/:alergiaId')
  alterar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('alergiaId', ParseUUIDPipe) alergiaId: string,
    @Body() dto: AlteracaoAlergiaDto,
  ): Promise<Alergia> {
    return this.alergias.alterar(usuario, alergiaId, dto);
  }

  @Auditar({
    acao: 'ALERGIA_EXCLUIDA',
    entidade: 'AlergiaRestricao',
    nivel: 'ALERTA',
    parametro: 'alergiaId',
  })
  @Delete('alergias/:alergiaId')
  @HttpCode(204)
  async excluir(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('alergiaId', ParseUUIDPipe) alergiaId: string,
  ): Promise<void> {
    await this.alergias.excluir(usuario, alergiaId);
  }
}
