import { Body, Controller, HttpCode, Ip, Post } from '@nestjs/common';
import { Publica } from '../../../compartilhado/auth/usuario-autenticado';
import { CadastroService, UsuarioCriado } from '../aplicacao/cadastro.service';
import {
  CadastroEmpresaDto,
  CadastroTutorDto,
  ConfirmacaoDto,
} from './cadastro.dto';

@Controller('auth')
export class CadastroController {
  constructor(private readonly cadastro: CadastroService) {}

  /** UC-01: cadastro do tutor; a conta fica pendente até a confirmação do e-mail. */
  @Publica()
  @Post('cadastro/tutor')
  cadastrarTutor(
    @Body() dto: CadastroTutorDto,
    @Ip() ip: string,
  ): Promise<UsuarioCriado> {
    return this.cadastro.cadastrarTutor(dto, ip);
  }

  /** UC-32: cadastro da empresa Enterprise. */
  @Publica()
  @Post('cadastro/empresa')
  cadastrarEmpresa(
    @Body() dto: CadastroEmpresaDto,
    @Ip() ip: string,
  ): Promise<UsuarioCriado> {
    return this.cadastro.cadastrarEmpresa(dto, ip);
  }

  /** RN02: confirma o e-mail e ativa a conta. */
  @Publica()
  @Post('confirmacao')
  @HttpCode(204)
  async confirmar(@Body() dto: ConfirmacaoDto): Promise<void> {
    await this.cadastro.confirmarEmail(dto.token);
  }
}
