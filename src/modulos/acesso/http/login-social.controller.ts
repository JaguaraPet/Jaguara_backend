import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Ip,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  Equals,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { Publica } from '../../../compartilhado/auth/usuario-autenticado';
import type { Tokens } from '../aplicacao/autenticacao.service';
import {
  CadastroPendente,
  LoginSocialService,
} from '../aplicacao/login-social.service';
import type { ProvedorSocial } from '../dominio/identidade-social';

export class LoginSocialDto {
  @IsIn(['GOOGLE', 'APPLE'], { message: 'Escolha Google ou Apple' })
  provedor: ProvedorSocial;

  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  idToken: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  nonce: string;

  /** Senha da conta do Jaguara com o mesmo e-mail, para ligar a identidade (CT-02-04). */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  senha?: string;
}

export class CadastroSocialDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  cadastroToken: string;

  @IsString()
  @IsNotEmpty({ message: 'Informe o nome' })
  @MaxLength(255)
  nome: string;

  @Matches(/^[0-9]{11}$/, { message: 'Informe o CPF com 11 números' })
  cpf: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  telefone?: string;

  @Equals(true, {
    message:
      'Para continuar, aceite os termos de uso e a política de privacidade',
  })
  aceiteTermos: boolean;
}

/** Login e cadastro com Google ou Apple (UC-01, UC-02 FA04, RF46). */
@Controller('auth')
export class LoginSocialController {
  constructor(private readonly social: LoginSocialService) {}

  @Publica()
  @Post('login/social')
  @HttpCode(200)
  async entrar(
    @Body() dto: LoginSocialDto,
    @Res({ passthrough: true }) resposta: Response,
    @Headers('user-agent') dispositivo?: string,
  ): Promise<Tokens | CadastroPendente> {
    const resultado = await this.social.entrar(dto, dispositivo);
    if (resultado.tipo === 'sessao') return resultado.tokens;
    resposta.status(428);
    return resultado.pendente;
  }

  @Publica()
  @Post('cadastro/social')
  cadastrar(
    @Body() dto: CadastroSocialDto,
    @Ip() ip: string,
    @Headers('user-agent') dispositivo?: string,
  ): Promise<Tokens> {
    return this.social.concluirCadastro(dto, ip, dispositivo);
  }
}
