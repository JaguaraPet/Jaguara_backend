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
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  Permissoes,
  SomenteEnterprise,
} from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import {
  Funcionario,
  FuncionariosService,
} from '../aplicacao/funcionarios.service';

export class NovoFuncionarioDto {
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome' })
  @MaxLength(255)
  nome: string;

  @Matches(/^[0-9]{11}$/, { message: 'Informe o CPF com 11 números' })
  cpf: string;

  @IsEmail({}, { message: 'Informe um e-mail válido' })
  @MaxLength(255)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  cargo?: string;

  @IsUUID('all', { message: 'Escolha um perfil de acesso' })
  @Type(() => String)
  perfilId: string;
}

export class AlterarPerfilDto {
  @IsUUID('all', { message: 'Escolha um perfil de acesso' })
  perfilId: string;
}

@SomenteEnterprise()
@Controller()
export class FuncionariosController {
  constructor(private readonly funcionarios: FuncionariosService) {}

  /** UC-19: lista a equipe. */
  @Permissoes('funcionario:ler')
  @Get('empresas/:empresaId/funcionarios')
  listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
  ): Promise<Funcionario[]> {
    return this.funcionarios.listar(usuario, empresaId);
  }

  /** UC-19: cadastra e convida por e-mail. */
  @Permissoes('funcionario:editar')
  @Post('empresas/:empresaId/funcionarios')
  cadastrar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
    @Body() dto: NovoFuncionarioDto,
  ): Promise<Funcionario> {
    return this.funcionarios.cadastrar(usuario, empresaId, dto);
  }

  /** UC-16: troca o perfil de acesso do funcionário. */
  @Permissoes('funcionario:editar')
  @Patch('funcionarios/:funcionarioId')
  alterarPerfil(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('funcionarioId', ParseUUIDPipe) funcionarioId: string,
    @Body() dto: AlterarPerfilDto,
  ): Promise<Funcionario> {
    return this.funcionarios.alterarPerfil(
      usuario,
      funcionarioId,
      dto.perfilId,
    );
  }

  /** UC-19, RN23: desliga e revoga todos os acessos. */
  @Permissoes('funcionario:editar')
  @Delete('funcionarios/:funcionarioId')
  @HttpCode(204)
  async desligar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('funcionarioId', ParseUUIDPipe) funcionarioId: string,
  ): Promise<void> {
    await this.funcionarios.desligar(usuario, funcionarioId);
  }
}
