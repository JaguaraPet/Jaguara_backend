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
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
} from 'class-validator';
import {
  Permissoes,
  SomenteTutor,
} from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import {
  AlimentacaoService,
  PlanoAlimentar,
} from '../aplicacao/alimentacao.service';

export class PlanoAlimentarDto {
  @IsString({ message: 'Informe o alimento' })
  @IsNotEmpty({ message: 'Informe o alimento' })
  @MaxLength(255)
  alimento: string;

  @IsNumber({}, { message: 'Informe a meta diária em gramas' })
  @IsPositive({ message: 'A meta precisa ser maior que zero' })
  @Max(100_000)
  metaDiariaGramas: number;

  @IsOptional()
  @IsNumber({}, { message: 'Informe o limite diário em gramas' })
  @IsPositive({ message: 'O limite precisa ser maior que zero' })
  @Max(100_000)
  limiteDiarioGramas?: number;

  @IsInt({ message: 'Informe quantas refeições por dia' })
  refeicoesPorDia: number;
}

export class RefeicaoDto {
  @IsDateString({}, { message: 'Informe a data e a hora' })
  dataHora: string;

  @IsString({ message: 'Informe o alimento' })
  @IsNotEmpty({ message: 'Informe o alimento' })
  @MaxLength(255)
  alimento: string;

  @IsNumber({}, { message: 'Informe a quantidade em gramas' })
  @IsPositive({ message: 'A quantidade precisa ser maior que zero' })
  @Max(100_000)
  quantidadeGramas: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observacao?: string;
}

export class DiaDto {
  @IsOptional()
  @IsDateString(
    { strict: true },
    { message: 'Informe o dia no formato AAAA-MM-DD' },
  )
  data?: string;
}

/** Alimentação do pet: responsáveis com rotina:ler e rotina:editar. */
@SomenteTutor()
@Controller('pets/:petId')
export class AlimentacaoController {
  constructor(private readonly alimentacao: AlimentacaoService) {}

  @Permissoes('rotina:ler')
  @Get('plano-alimentar')
  async plano(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
  ): Promise<{ plano: PlanoAlimentar | null }> {
    return { plano: await this.alimentacao.plano(usuario, petId) };
  }

  @Permissoes('rotina:editar')
  @Put('plano-alimentar')
  definirPlano(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
    @Body() dto: PlanoAlimentarDto,
  ): Promise<PlanoAlimentar> {
    return this.alimentacao.definirPlano(usuario, petId, dto);
  }

  @Permissoes('rotina:ler')
  @Get('refeicoes')
  refeicoes(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
    @Query() filtro: DiaDto,
  ) {
    return this.alimentacao.refeicoesDoDia(usuario, petId, filtro.data);
  }

  @Permissoes('rotina:editar')
  @Post('refeicoes')
  registrar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
    @Body() dto: RefeicaoDto,
  ) {
    return this.alimentacao.registrarRefeicao(usuario, petId, dto);
  }
}
