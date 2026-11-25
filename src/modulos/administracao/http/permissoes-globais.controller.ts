import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsString } from 'class-validator';
import {
  Permissoes,
  SomenteAdministrador,
} from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Auditar } from '../../../compartilhado/auditoria/auditoria.interceptor';
import {
  PerfilGlobal,
  PermissaoCatalogo,
  PermissoesGlobaisService,
} from '../aplicacao/permissoes-globais.service';

export class PermissoesGlobaisDto {
  @IsArray({ message: 'Escolha as permissões' })
  @ArrayMaxSize(60)
  @IsString({ each: true })
  permissoes: string[];
}

/** Permissões globais da plataforma (UC-29, RN35). */
@SomenteAdministrador()
@Permissoes('admin:usuarios')
@Controller('admin')
export class PermissoesGlobaisController {
  constructor(private readonly globais: PermissoesGlobaisService) {}

  @Get('permissoes')
  catalogo(): PermissaoCatalogo[] {
    return this.globais.catalogo();
  }

  @Get('perfis')
  listar(): Promise<PerfilGlobal[]> {
    return this.globais.listar();
  }

  @Auditar({
    acao: 'PERMISSOES_GLOBAIS_ALTERADAS',
    entidade: 'PerfilAcesso',
    nivel: 'CRITICO',
    parametro: 'perfilId',
  })
  @Put('perfis/:perfilId')
  alterar(
    @UsuarioAtual() admin: UsuarioAutenticado,
    @Param('perfilId', ParseUUIDPipe) perfilId: string,
    @Body() dto: PermissoesGlobaisDto,
  ): Promise<PerfilGlobal> {
    return this.globais.alterar(admin, perfilId, dto.permissoes);
  }
}
