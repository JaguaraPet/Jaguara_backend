import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  Autenticado,
  Permissoes,
  SomenteAdministrador,
} from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import {
  Chamado,
  ChamadoDetalhe,
  ChamadoResumo,
  ChamadosService,
} from '../aplicacao/chamados.service';
import { STATUS_CHAMADO } from '../dominio/chamado';
import type { StatusChamado, StatusIntervencao } from '../dominio/chamado';

export class NovoChamadoDto {
  @IsString({ message: 'Dê um título ao chamado' })
  @MinLength(5, { message: 'Resuma o problema em pelo menos 5 caracteres' })
  @MaxLength(120)
  titulo: string;

  @IsString({ message: 'Descreva o problema' })
  @MinLength(10, { message: 'Descreva o problema em pelo menos 10 caracteres' })
  @MaxLength(4000)
  descricao: string;
}

export class MensagemChamadoDto {
  @IsString({ message: 'Escreva a mensagem' })
  @MinLength(5, { message: 'Escreva pelo menos 5 caracteres' })
  @MaxLength(2000)
  mensagem: string;
}

export class IntervencaoDto {
  @IsString({ message: 'Informe a ação executada' })
  @MinLength(3, { message: 'Informe a ação executada' })
  @MaxLength(255)
  acaoExecutada: string;

  @IsString({ message: 'Descreva o que foi feito' })
  @MinLength(5, {
    message: 'Descreva o que foi feito em pelo menos 5 caracteres',
  })
  @MaxLength(2000)
  descricao: string;

  @IsIn(['EM_ANALISE', 'RESOLVIDO', 'FECHADO'], {
    message: 'Escolha a nova situação do chamado',
  })
  status: StatusIntervencao;
}

export class FiltroChamadosDto {
  @IsOptional()
  @IsIn(STATUS_CHAMADO)
  status?: StatusChamado;
}

/** Abertura e acompanhamento do chamado por quem pede ajuda (UC-26). */
@Controller('chamados')
export class ChamadosController {
  constructor(private readonly chamados: ChamadosService) {}

  @Autenticado()
  @Post()
  abrir(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() dto: NovoChamadoDto,
  ): Promise<Chamado> {
    return this.chamados.abrir(usuario, dto);
  }

  @Autenticado()
  @Get()
  meus(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<Chamado[]> {
    return this.chamados.meus(usuario);
  }

  @Autenticado()
  @Post(':chamadoId/complemento')
  complementar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('chamadoId', ParseUUIDPipe) chamadoId: string,
    @Body() dto: MensagemChamadoDto,
  ): Promise<Chamado> {
    return this.chamados.complementar(usuario, chamadoId, dto.mensagem);
  }
}

/** Central de suporte da administração (UC-26, RN32). */
@SomenteAdministrador()
@Permissoes('admin:suporte')
@Controller('admin/chamados')
export class ChamadosAdminController {
  constructor(private readonly chamados: ChamadosService) {}

  @Get()
  listar(@Query() filtro: FiltroChamadosDto): Promise<ChamadoResumo[]> {
    return this.chamados.listar(filtro.status);
  }

  @Get(':chamadoId')
  detalhar(
    @Param('chamadoId', ParseUUIDPipe) chamadoId: string,
  ): Promise<ChamadoDetalhe> {
    return this.chamados.detalhar(chamadoId);
  }

  @Post(':chamadoId/intervencoes')
  intervir(
    @UsuarioAtual() admin: UsuarioAutenticado,
    @Param('chamadoId', ParseUUIDPipe) chamadoId: string,
    @Body() dto: IntervencaoDto,
    @Ip() ip: string,
  ): Promise<ChamadoDetalhe> {
    return this.chamados.intervir(admin, chamadoId, dto, ip);
  }

  @Post(':chamadoId/pedido-informacao')
  pedirInformacao(
    @UsuarioAtual() admin: UsuarioAutenticado,
    @Param('chamadoId', ParseUUIDPipe) chamadoId: string,
    @Body() dto: MensagemChamadoDto,
    @Ip() ip: string,
  ): Promise<ChamadoDetalhe> {
    return this.chamados.pedirInformacao(admin, chamadoId, dto.mensagem, ip);
  }
}
