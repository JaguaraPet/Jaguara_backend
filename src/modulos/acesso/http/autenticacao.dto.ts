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
