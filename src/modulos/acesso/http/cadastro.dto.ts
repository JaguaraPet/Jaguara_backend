import { Type } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const ACEITE =
  'Aceite os termos de uso e a política de privacidade para continuar (RN42).';

export class CadastroTutorDto {
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
  @MaxLength(20)
  telefone?: string;

  @IsString()
  @MinLength(8, { message: 'A senha precisa ter pelo menos 8 caracteres' })
  @MaxLength(128)
  senha: string;

  @Equals(true, { message: ACEITE })
  aceiteTermos: boolean;
}

export class EnderecoDto {
  @Matches(/^[0-9]{8}$/, { message: 'Informe o CEP com 8 números' })
  cep: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  logradouro: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  numero: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  complemento?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  bairro: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  cidade: string;

  @Matches(/^[A-Z]{2}$/, { message: 'Informe a UF com 2 letras maiúsculas' })
  uf: string;
}

export class CadastroEmpresaDto {
  @Matches(/^[0-9]{14}$/, { message: 'Informe o CNPJ com 14 números' })
  cnpj: string;

  @IsString()
  @IsNotEmpty({ message: 'Informe a razão social' })
  @MaxLength(255)
  razaoSocial: string;

  @IsString()
  @IsNotEmpty({ message: 'Informe o nome fantasia' })
  @MaxLength(255)
  nomeFantasia: string;

  @IsIn([
    'CLINICA_VETERINARIA',
    'PET_SHOP',
    'HOTEL_PET',
    'CRECHE',
    'CASA_DE_CUIDADO',
  ])
  tipo:
    | 'CLINICA_VETERINARIA'
    | 'PET_SHOP'
    | 'HOTEL_PET'
    | 'CRECHE'
    | 'CASA_DE_CUIDADO';

  @IsEmail({}, { message: 'Informe um e-mail válido' })
  @MaxLength(255)
  email: string;

  @IsString()
  @MinLength(8, { message: 'A senha precisa ter pelo menos 8 caracteres' })
  @MaxLength(128)
  senha: string;

  @ValidateNested()
  @Type(() => EnderecoDto)
  endereco: EnderecoDto;

  @Equals(true, { message: ACEITE })
  aceiteTermos: boolean;
}

export class ConfirmacaoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  token: string;
}
