import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import {
  Publica,
  UsuarioAtual,
} from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Autenticado } from '../../../compartilhado/auth/permissoes';
import { AutenticacaoService, Tokens } from '../aplicacao/autenticacao.service';
import { LoginDto, RenovacaoDto } from './autenticacao.dto';

@Controller('auth')
export class AutenticacaoController {
  constructor(private readonly autenticacao: AutenticacaoService) {}

  /** UC-02: autenticar com e-mail e senha. */
  @Publica()
  @Post('login')
  @HttpCode(200)
  login(
    @Body() dto: LoginDto,
    @Headers('user-agent') dispositivo?: string,
  ): Promise<Tokens> {
    return this.autenticacao.login(dto.email, dto.senha, dispositivo);
  }

  /** Renova o access token e troca o refresh token (ADR-012). */
  @Publica()
  @Post('renovacao')
  @HttpCode(200)
  renovar(@Body() dto: RenovacaoDto): Promise<Tokens> {
    return this.autenticacao.renovar(dto.refreshToken);
  }

  /** Encerra a sessão atual. */
  @Autenticado()
  @Post('logout')
  @HttpCode(204)
  async logout(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<void> {
    await this.autenticacao.encerrar(usuario.sid);
  }
}
