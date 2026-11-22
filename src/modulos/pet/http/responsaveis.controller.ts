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
import { IsEmail, IsIn, MaxLength } from 'class-validator';
import {
  Permissoes,
  SomenteTutor,
} from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Auditar } from '../../../compartilhado/auditoria/auditoria.interceptor';
import {
  Responsavel,
  ResponsaveisService,
} from '../aplicacao/responsaveis.service';
import type { TipoResponsavel } from '../dominio/responsaveis';

const TIPOS: TipoResponsavel[] = ['PRINCIPAL', 'ADICIONAL'];

export class NovoResponsavelDto {
  @IsEmail({}, { message: 'Informe o e-mail da conta da pessoa' })
  @MaxLength(255)
  email: string;

  @IsIn(TIPOS, { message: 'Escolha principal ou adicional' })
  tipo: TipoResponsavel;
}

export class TipoResponsavelDto {
  @IsIn(TIPOS, { message: 'Escolha principal ou adicional' })
  tipo: TipoResponsavel;
}

/** Responsáveis pelo pet (UC-05, RN09). */
@SomenteTutor()
@Controller('pets/:petId/responsaveis')
export class ResponsaveisController {
  constructor(private readonly responsaveis: ResponsaveisService) {}

  @Permissoes('pet:ler')
  @Get()
  listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
  ): Promise<Responsavel[]> {
    return this.responsaveis.listar(usuario, petId);
  }

  @Permissoes('pet:editar')
  @Auditar({
    acao: 'RESPONSAVEL_VINCULADO',
    entidade: 'Pet',
    nivel: 'INFO',
    parametro: 'petId',
  })
  @Post()
  vincular(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
    @Body() dto: NovoResponsavelDto,
  ): Promise<Responsavel[]> {
    return this.responsaveis.vincular(usuario, petId, dto);
  }

  @Permissoes('pet:editar')
  @Patch(':tutorId')
  mudarTipo(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
    @Param('tutorId', ParseUUIDPipe) tutorId: string,
    @Body() dto: TipoResponsavelDto,
  ): Promise<Responsavel[]> {
    return this.responsaveis.mudarTipo(usuario, petId, tutorId, dto.tipo);
  }

  @Permissoes('pet:editar')
  @Auditar({
    acao: 'RESPONSAVEL_REMOVIDO',
    entidade: 'Pet',
    nivel: 'INFO',
    parametro: 'petId',
  })
  @Delete(':tutorId')
  @HttpCode(204)
  async remover(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
    @Param('tutorId', ParseUUIDPipe) tutorId: string,
  ): Promise<void> {
    await this.responsaveis.remover(usuario, petId, tutorId);
  }
}
