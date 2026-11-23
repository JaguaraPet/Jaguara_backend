import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  Permissoes,
  SomenteEnterprise,
} from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Auditar } from '../../../compartilhado/auditoria/auditoria.interceptor';
import type { PerfilDaEmpresa } from '../aplicacao/funcionarios.service';
import {
  PerfisService,
  PermissaoDisponivel,
} from '../aplicacao/perfis.service';

export class PerfilDto {
  @IsString({ message: 'Dê um nome ao perfil' })
  @MaxLength(60)
  nome: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  descricao?: string;

  @IsArray({ message: 'Escolha as permissões' })
  @ArrayMaxSize(50)
  @IsString({ each: true })
  permissoes: string[];
}

/** Perfis e permissões da empresa (UC-16, RN20). */
@SomenteEnterprise()
@Controller()
export class PerfisController {
  constructor(private readonly perfis: PerfisService) {}

  @Permissoes('funcionario:ler')
  @Get('empresas/:empresaId/permissoes')
  permissoes(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
  ): PermissaoDisponivel[] {
    return this.perfis.permissoesDisponiveis(usuario, empresaId);
  }

  @Permissoes('perfil:editar')
  @Auditar({ acao: 'PERFIL_CRIADO', entidade: 'PerfilAcesso', nivel: 'INFO' })
  @Post('empresas/:empresaId/perfis')
  criar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
    @Body() dto: PerfilDto,
  ): Promise<PerfilDaEmpresa> {
    return this.perfis.criar(usuario, empresaId, dto);
  }

  @Permissoes('perfil:editar')
  @Auditar({
    acao: 'PERFIL_ALTERADO',
    entidade: 'PerfilAcesso',
    nivel: 'ALERTA',
    parametro: 'perfilId',
  })
  @Put('perfis/:perfilId')
  alterar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('perfilId', ParseUUIDPipe) perfilId: string,
    @Body() dto: PerfilDto,
  ): Promise<PerfilDaEmpresa> {
    return this.perfis.alterar(usuario, perfilId, dto);
  }

  @Permissoes('perfil:editar')
  @Auditar({
    acao: 'PERFIL_EXCLUIDO',
    entidade: 'PerfilAcesso',
    nivel: 'ALERTA',
    parametro: 'perfilId',
  })
  @Delete('perfis/:perfilId')
  @HttpCode(204)
  async excluir(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('perfilId', ParseUUIDPipe) perfilId: string,
  ): Promise<void> {
    await this.perfis.excluir(usuario, perfilId);
  }
}
