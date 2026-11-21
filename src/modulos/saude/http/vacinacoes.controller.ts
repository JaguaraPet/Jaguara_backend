import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Autenticado } from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Vacinacao, VacinacoesService } from '../aplicacao/vacinacoes.service';

const DATA = { strict: true };

export class VacinacaoEntradaDto {
  @IsString({ message: 'Informe a vacina' })
  @IsNotEmpty({ message: 'Informe a vacina' })
  @MaxLength(255)
  nomeVacina: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fabricante?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  lote?: string;

  @IsDateString(DATA, { message: 'Informe a data de aplicação (AAAA-MM-DD)' })
  dataAplicacao: string;

  @IsOptional()
  @IsDateString(DATA, { message: 'Informe a próxima dose (AAAA-MM-DD)' })
  dataProximaDose?: string;

  /** RN17: quem aplicou é obrigatório (CT-13-02). */
  @IsString({ message: 'Informe quem aplicou a vacina' })
  @IsNotEmpty({ message: 'Informe quem aplicou a vacina' })
  @MaxLength(255)
  responsavelAplicacao: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  observacoes?: string;
}

/** Vacinação do pet: tutor responsável ou empresa com o escopo VACINAS (RN15). */
@Autenticado()
@Controller('pets/:petId/vacinacoes')
export class VacinacoesController {
  constructor(private readonly vacinacoes: VacinacoesService) {}

  @Get()
  listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
  ): Promise<Vacinacao[]> {
    return this.vacinacoes.listar(usuario, petId);
  }

  @Post()
  cadastrar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
    @Body() dto: VacinacaoEntradaDto,
  ): Promise<Vacinacao> {
    return this.vacinacoes.cadastrar(usuario, petId, dto);
  }
}
