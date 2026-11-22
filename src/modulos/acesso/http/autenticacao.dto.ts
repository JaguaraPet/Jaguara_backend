import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Informe um e-mail válido' })
  @MaxLength(255)
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Informe a senha' })
  @MaxLength(128)
  senha: string;
}

export class RenovacaoDto {
  @IsString()
  @IsNotEmpty({ message: 'Informe o refresh token' })
  @MaxLength(255)
  refreshToken: string;
}

export class RecuperacaoSenhaDto {
  @IsEmail({}, { message: 'Informe um e-mail válido' })
  @MaxLength(255)
  email: string;
}

export class RedefinicaoSenhaDto {
  @IsString()
  @IsNotEmpty({
    message: 'O link está incompleto. Abra de novo o link do e-mail.',
  })
  @MaxLength(255)
  token: string;

  @IsString()
  @IsNotEmpty({ message: 'Informe a nova senha' })
  @MaxLength(128)
  novaSenha: string;
}
