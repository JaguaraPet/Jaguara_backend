import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Autenticado } from '../../../compartilhado/auth/permissoes';
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
  buscar(@Query() filtro: FiltroEmpresasDto) {
    return this.empresas.buscar(filtro);
  }

  @Autenticado()
  @Get(':empresaId')
  perfil(
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
  ): Promise<EmpresaPublica> {
    return this.empresas.perfil(empresaId);
  }
}
