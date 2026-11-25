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
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  Permissoes,
  SomenteTutor,
} from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Auditar } from '../../../compartilhado/auditoria/auditoria.interceptor';
import { MemorialDoPet, MemorialService } from '../aplicacao/memorial.service';
import type { TipoItemMemorial } from '../dominio/memorial';

export class MemorialDto {
  @IsString({ message: 'Escreva a mensagem do memorial' })
  @MaxLength(2000)
  mensagem: string;

  @IsBoolean()
  publico: boolean;
}

export class ItemMemorialDto {
  @IsIn(['FOTO', 'TEXTO', 'HOMENAGEM'], {
    message: 'Escolha o tipo da lembrança',
  })
  tipo: TipoItemMemorial;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  conteudo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  nomeArquivo?: string;

  @IsOptional()
  @IsInt()
  tamanhoBytes?: number;
}

/** Falecimento e memorial do pet (UC-15, RN19), só para os responsáveis. */
@SomenteTutor()
@Controller()
export class MemorialController {
  constructor(private readonly memorial: MemorialService) {}

  @Permissoes('pet:editar')
  @Auditar({
    acao: 'PET_FALECIMENTO',
    entidade: 'Pet',
    nivel: 'INFO',
    parametro: 'petId',
  })
  @Post('pets/:petId/falecimento')
  @HttpCode(204)
  async falecimento(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
  ): Promise<void> {
    await this.memorial.registrarFalecimento(usuario, petId);
  }

  @Permissoes('pet:ler')
  @Get('pets/:petId/memorial')
  consultar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
  ): Promise<MemorialDoPet> {
    return this.memorial.consultar(usuario, petId);
  }

  @Permissoes('pet:editar')
  @Put('pets/:petId/memorial')
  salvar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
    @Body() dto: MemorialDto,
  ): Promise<MemorialDoPet> {
    return this.memorial.salvar(usuario, petId, dto);
  }

  @Permissoes('pet:editar')
  @Post('pets/:petId/memorial/itens')
  adicionar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
    @Body() dto: ItemMemorialDto,
  ) {
    return this.memorial.adicionarItem(usuario, petId, dto);
  }

  @Permissoes('pet:editar')
  @Delete('memorial/itens/:itemId')
  @HttpCode(204)
  async remover(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<void> {
    await this.memorial.removerItem(usuario, itemId);
  }
}
