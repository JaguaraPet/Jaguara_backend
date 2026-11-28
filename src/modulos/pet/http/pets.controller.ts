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
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  Autenticado,
  Permissoes,
  SomenteTutor,
} from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Pet, PetsService } from '../aplicacao/pets.service';
import type { StatusPet } from '../aplicacao/pets.service';

export class PetEntradaDto {
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome do pet' })
  @MaxLength(255)
  nome: string;

  @IsUUID('all', { message: 'Escolha a raça' })
  racaId: string;

  @IsOptional()
  @IsString()
  @MaxLength(80, { message: 'Use até 80 caracteres' })
  racaDescricao?: string;

  @IsOptional()
  @IsDateString(
    { strict: true },
    { message: 'Informe a data no formato AAAA-MM-DD' },
  )
  dataNascimento?: string;

  @IsIn(['MACHO', 'FEMEA'], { message: 'Informe o sexo' })
  sexo: 'MACHO' | 'FEMEA';

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(500)
  pesoKg?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  cor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  microchip?: string;

  @IsBoolean({ message: 'Informe se o pet é castrado' })
  castrado: boolean;
}

export class FotoPetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  nomeArquivo: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  tamanhoBytes: number;
}

export class FiltroPetsDto {
  @IsOptional()
  @IsIn(['ATIVO', 'ARQUIVADO', 'FALECIDO'])
  status?: StatusPet;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  tamanho = 20;
}

@Controller()
export class PetsController {
  constructor(private readonly pets: PetsService) {}

  /** RN07: espécies e raças para escolher na lista. */
  @Autenticado()
  @Get('especies')
  especies() {
    return this.pets.listarEspecies();
  }

  @SomenteTutor()
  @Permissoes('pet:ler')
  @Get('pets')
  listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Query() filtro: FiltroPetsDto,
  ) {
    return this.pets.listar(usuario, filtro);
  }

  /** UC-04: cadastra com o tutor como responsável principal (RN09). */
  @SomenteTutor()
  @Permissoes('pet:editar')
  @Post('pets')
  cadastrar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() dto: PetEntradaDto,
  ): Promise<Pet> {
    return this.pets.cadastrar(usuario, dto);
  }

  /** Perfil do pet: responsáveis ou empresas com acesso (RN24, RN26). */
  @Autenticado()
  @Get('pets/:petId')
  consultar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
  ): Promise<Pet> {
    return this.pets.consultar(usuario, petId);
  }

  @Autenticado()
  @Patch('pets/:petId')
  editar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
    @Body() dto: PetEntradaDto,
  ): Promise<Pet> {
    return this.pets.editar(usuario, petId, dto);
  }

  /** RN08: só exclui sem histórico; senão, arquive. */
  @SomenteTutor()
  @Permissoes('pet:editar')
  @Delete('pets/:petId')
  @HttpCode(204)
  async excluir(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
  ): Promise<void> {
    await this.pets.excluir(usuario, petId);
  }

  @SomenteTutor()
  @Permissoes('pet:editar')
  @Post('pets/:petId/arquivamento')
  @HttpCode(204)
  async arquivar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
  ): Promise<void> {
    await this.pets.arquivar(usuario, petId);
  }

  @SomenteTutor()
  @Permissoes('pet:editar')
  @Delete('pets/:petId/arquivamento')
  @HttpCode(204)
  async desarquivar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
  ): Promise<void> {
    await this.pets.desarquivar(usuario, petId);
  }

  /** Prepara o envio da foto do pet: devolve a URL para o app enviar o arquivo. */
  @Autenticado()
  @Post('pets/:petId/foto')
  prepararFoto(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
    @Body() dto: FotoPetDto,
  ) {
    return this.pets.prepararFoto(usuario, petId, dto);
  }

  @Autenticado()
  @Delete('pets/:petId/foto')
  @HttpCode(204)
  removerFoto(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
  ): Promise<void> {
    return this.pets.removerFoto(usuario, petId);
  }
}
