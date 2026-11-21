import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  Autenticado,
  Permissoes,
  SomenteEnterprise,
} from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import {
  CatalogoService,
  Recurso,
  Servico,
} from '../aplicacao/catalogo.service';
import type {
  CategoriaServico,
  TipoRecurso,
} from '../aplicacao/catalogo.service';

const CATEGORIAS = [
  'CONSULTA',
  'EXAME',
  'CIRURGIA',
  'VACINACAO',
  'BANHO_TOSA',
  'HOSPEDAGEM',
  'PET_SITTER',
  'CRECHE',
  'OUTRO',
];

export class ServicoEntradaDto {
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome do serviço' })
  @MaxLength(255)
  nome: string;

  @IsString()
  @IsNotEmpty({ message: 'Descreva o serviço' })
  @MaxLength(2000)
  descricao: string;

  @IsIn(CATEGORIAS, { message: 'Escolha uma categoria válida' })
  categoria: CategoriaServico;

  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'Informe o preço com até 2 casas decimais' },
  )
  @Min(0)
  @Max(1_000_000)
  preco: number;

  @Type(() => Number)
  @IsInt({ message: 'Informe a duração em minutos' })
  @Min(5, { message: 'A duração mínima é de 5 minutos' })
  @Max(24 * 60 * 30)
  duracaoMinutos: number;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

export class RecursoEntradaDto {
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome do recurso' })
  @MaxLength(255)
  nome: string;

  @IsIn(['SALA', 'EQUIPAMENTO', 'BAIA', 'VEICULO', 'OUTRO'], {
    message: 'Escolha um tipo de recurso válido',
  })
  tipo: TipoRecurso;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

@Controller()
export class CatalogoController {
  constructor(private readonly catalogo: CatalogoService) {}

  /** UC-33 e UC-38: catálogo da empresa; tutores veem só os serviços ativos. */
  @Autenticado()
  @Get('empresas/:empresaId/servicos')
  listarServicos(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
  ): Promise<Servico[]> {
    return this.catalogo.listarServicos(usuario, empresaId);
  }

  @SomenteEnterprise()
  @Permissoes('servico:editar')
  @Post('empresas/:empresaId/servicos')
  criarServico(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
    @Body() dto: ServicoEntradaDto,
  ): Promise<Servico> {
    return this.catalogo.criarServico(usuario, empresaId, dto);
  }

  /** Alterar o preço não muda agendamentos já contratados (RN27). */
  @SomenteEnterprise()
  @Permissoes('servico:editar')
  @Patch('servicos/:servicoId')
  alterarServico(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('servicoId', ParseUUIDPipe) servicoId: string,
    @Body() dto: ServicoEntradaDto,
  ): Promise<Servico> {
    return this.catalogo.alterarServico(usuario, servicoId, dto);
  }

  @SomenteEnterprise()
  @Permissoes('servico:ler')
  @Get('empresas/:empresaId/recursos')
  listarRecursos(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
  ): Promise<Recurso[]> {
    return this.catalogo.listarRecursos(usuario, empresaId);
  }

  @SomenteEnterprise()
  @Permissoes('recurso:editar')
  @Post('empresas/:empresaId/recursos')
  criarRecurso(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
    @Body() dto: RecursoEntradaDto,
  ): Promise<Recurso> {
    return this.catalogo.criarRecurso(usuario, empresaId, dto);
  }

  @SomenteEnterprise()
  @Permissoes('recurso:editar')
  @Patch('recursos/:recursoId')
  alterarRecurso(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('recursoId', ParseUUIDPipe) recursoId: string,
    @Body() dto: RecursoEntradaDto,
  ): Promise<Recurso> {
    return this.catalogo.alterarRecurso(usuario, recursoId, dto);
  }
}
