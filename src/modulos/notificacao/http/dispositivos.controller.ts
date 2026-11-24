import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { IsIn, IsString, MaxLength } from 'class-validator';
import { Autenticado } from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { DispositivosService } from '../aplicacao/dispositivos.service';

export class DispositivoDto {
  @IsString({ message: 'Informe o token de push' })
  @MaxLength(255)
  token: string;

  @IsIn(['ios', 'android', 'web'], { message: 'Plataforma inválida' })
  plataforma: string;
}

/** Aparelhos para push (UC-31): o app registra no login e remove na saída. */
@Autenticado()
@Controller('dispositivos')
export class DispositivosController {
  constructor(private readonly dispositivos: DispositivosService) {}

  @Post()
  @HttpCode(204)
  async registrar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() dto: DispositivoDto,
  ): Promise<void> {
    await this.dispositivos.registrar(usuario, dto);
  }

  @Delete(':token')
  @HttpCode(204)
  async remover(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('token') token: string,
  ): Promise<void> {
    await this.dispositivos.remover(usuario, token);
  }
}
