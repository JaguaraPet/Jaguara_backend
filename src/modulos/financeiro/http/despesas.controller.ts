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
  IsNotEmpty,
  IsNumber,
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
  Categoria,
  Despesa,
  DespesasService,
} from '../aplicacao/despesas.service';

const DATA = { strict: true };

export class DespesaEntradaDto {
  @IsString({ message: 'Descreva a despesa' })
  @IsNotEmpty({ message: 'Descreva a despesa' })
  @MaxLength(255)
  descricao: string;

  @IsNumber({}, { message: 'Informe o valor' })
  valor: number;

  @IsDateString(DATA, { message: 'Informe a data (AAAA-MM-DD)' })
  data: string;

  /** RN10: a categoria é obrigatória (CT-06-02). */
  @IsUUID('all', { message: 'Escolha uma categoria' })
  categoriaId: string;
}

export class FiltroDespesasDto {
  @IsOptional()
  @IsDateString(DATA, { message: 'Informe a data inicial (AAAA-MM-DD)' })
  de?: string;

  @IsOptional()
  @IsDateString(DATA, { message: 'Informe a data final (AAAA-MM-DD)' })
  ate?: string;

  @IsOptional()
  @IsUUID()
  categoriaId?: string;
}

@Controller()
export class DespesasController {
  constructor(private readonly despesas: DespesasService) {}

  /** Categorias para o formulário de despesa (RN10). */
  @Autenticado()
  @Get('categorias-despesa')
  categorias(): Promise<Categoria[]> {
    return this.despesas.categorias();
  }

  @SomenteTutor()
  @Permissoes('rotina:ler')
  @Get('pets/:petId/despesas')
  listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
    @Query() filtro: FiltroDespesasDto,
  ): Promise<Despesa[]> {
    return this.despesas.listar(usuario, petId, filtro);
  }

  @SomenteTutor()
  @Permissoes('rotina:editar')
  @Post('pets/:petId/despesas')
  registrar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
    @Body() dto: DespesaEntradaDto,
  ): Promise<Despesa> {
    return this.despesas.registrar(usuario, petId, dto);
  }
}
