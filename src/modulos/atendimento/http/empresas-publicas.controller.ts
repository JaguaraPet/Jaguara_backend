import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  Matches,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Autenticado } from '../../../compartilhado/auth/permissoes';
import {
  UsuarioAtual,
  type UsuarioAutenticado,
} from '../../../compartilhado/auth/usuario-autenticado';
import type { CategoriaServico } from '../aplicacao/catalogo.service';
import {
  EmpresaPublica,
  EmpresasPublicasService,
} from '../aplicacao/empresas-publicas.service';
import type { TipoEmpresa } from '../aplicacao/empresas-publicas.service';

export class FiltroEmpresasDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  busca?: string;

  @IsOptional()
  @IsIn([
    'CLINICA_VETERINARIA',
    'PET_SHOP',
    'HOTEL_PET',
    'CRECHE',
    'CASA_DE_CUIDADO',
  ])
  tipo?: TipoEmpresa;

  @IsOptional()
  @IsIn([
    'CONSULTA',
    'EXAME',
    'CIRURGIA',
    'VACINACAO',
    'BANHO_TOSA',
    'HOSPEDAGEM',
    'PET_SITTER',
    'CRECHE',
    'OUTRO',
  ])
  categoria?: CategoriaServico;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  cidade?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  perto?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @Matches(/^\d{5}-?\d{3}$/, { message: 'Informe o CEP com 8 números' })
  cep?: string;

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

/** Busca de empresas e perfil público (UC-33), para qualquer usuário logado. */
@Controller('empresas')
export class EmpresasPublicasController {
  constructor(private readonly empresas: EmpresasPublicasService) {}

  @Autenticado()
  @Get()
  buscar(
    @Query() filtro: FiltroEmpresasDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ) {
    return this.empresas.buscar(filtro, usuario.sub);
  }

  @Autenticado()
  @Get(':empresaId')
  perfil(
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
  ): Promise<EmpresaPublica> {
    return this.empresas.perfil(empresaId);
  }
}
