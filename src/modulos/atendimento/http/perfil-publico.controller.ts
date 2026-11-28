import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  Permissoes,
  SomenteEnterprise,
} from '../../../compartilhado/auth/permissoes';
import {
  Publica,
  UsuarioAtual,
  type UsuarioAutenticado,
} from '../../../compartilhado/auth/usuario-autenticado';
import {
  FORMAS_PAGAMENTO,
  PerfilPublicoService,
} from '../aplicacao/perfil-publico.service';

export class PerfilPublicoDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1500, { message: 'A descrição pode ter até 1.500 caracteres' })
  descricao?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  telefonePublico?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  whatsapp?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  instagram?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  horarioFuncionamento?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(FORMAS_PAGAMENTO.length)
  @IsIn(FORMAS_PAGAMENTO, {
    each: true,
    message: 'Forma de pagamento inválida',
  })
  formasPagamento?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(1500)
  politicaCancelamento?: string | null;
}

@Controller()
export class PerfilPublicoController {
  constructor(private readonly perfil: PerfilPublicoService) {}

  /** A empresa lê o próprio perfil público para editar. */
  @SomenteEnterprise()
  @Permissoes('empresa:editar')
  @Get('empresas/:empresaId/perfil-publico')
  ler(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
  ) {
    return this.perfil.ler(usuario, empresaId);
  }

  /** A empresa edita o que o tutor vê no app e na página pública. */
  @SomenteEnterprise()
  @Permissoes('empresa:editar')
  @Patch('empresas/:empresaId/perfil-publico')
  atualizar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
    @Body() dto: PerfilPublicoDto,
  ) {
    return this.perfil.atualizar(usuario, empresaId, dto);
  }

  /** Página pública /e/{slug}, sem login. */
  @Publica()
  @Get('publico/empresas/:slug')
  vitrine(@Param('slug') slug: string) {
    return this.perfil.vitrine(slug);
  }
}
