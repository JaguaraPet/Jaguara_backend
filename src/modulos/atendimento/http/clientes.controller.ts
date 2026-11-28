import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  Permissoes,
  SomenteEnterprise,
} from '../../../compartilhado/auth/permissoes';
import { Auditar } from '../../../compartilhado/auditoria/auditoria.interceptor';
import {
  Publica,
  UsuarioAtual,
} from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import {
  ClienteResposta,
  ClientesService,
} from '../aplicacao/clientes.service';

export class ArquivoTermoDto {
  @IsString()
  @MaxLength(255)
  nomeArquivo: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  tamanhoBytes: number;
}

export class NovoClienteDto {
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome do cliente' })
  @MaxLength(255)
  nome: string;

  @IsOptional()
  @Matches(/^[0-9.-]{11,14}$/, { message: 'Informe o CPF com 11 números' })
  cpf?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  telefone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Informe um e-mail válido' })
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  observacoes?: string;

  @IsIn(['ASSINATURA_PRESENCIAL', 'LINK_DIGITAL'], {
    message: 'Escolha como o consentimento é coletado',
  })
  meioConsentimento: 'ASSINATURA_PRESENCIAL' | 'LINK_DIGITAL';

  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'Informe a URL da cópia do termo' })
  evidenciaArquivoUrl?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ArquivoTermoDto)
  evidenciaArquivo?: ArquivoTermoDto;
}

export class PetEntradaDto {
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome do pet' })
  @MaxLength(255)
  nome: string;

  @IsUUID('all', { message: 'Escolha a raça' })
  racaId: string;

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

@SomenteEnterprise()
@Controller('empresas/:empresaId/clientes')
export class ClientesController {
  constructor(private readonly clientes: ClientesService) {}

  @Permissoes('cliente:ler')
  @Get()
  listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
  ): Promise<ClienteResposta[]> {
    return this.clientes.listar(usuario, empresaId);
  }

  /** UC-21: cadastro com consentimento presencial ou pré-cadastro com link do termo (RN41). */
  @Permissoes('cliente:editar')
  @Auditar({ acao: 'CLIENTE_CADASTRADO', entidade: 'Cliente', nivel: 'INFO' })
  @Post()
  cadastrar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
    @Body() dto: NovoClienteDto,
    @Ip() ip: string,
  ): Promise<ClienteResposta> {
    return this.clientes.cadastrar(usuario, empresaId, dto, ip);
  }

  /** Pet de cliente sem conta (ADR-010). */
  @Permissoes('cliente:editar')
  @Post(':clienteId/pets')
  cadastrarPet(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
    @Param('clienteId', ParseUUIDPipe) clienteId: string,
    @Body() dto: PetEntradaDto,
  ) {
    return this.clientes.cadastrarPet(usuario, empresaId, clienteId, dto);
  }

  /** Anexa ou troca a cópia do termo assinado no balcão (RN41). */
  @Permissoes('cliente:editar')
  @Post(':clienteId/consentimento/termo')
  anexarTermo(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
    @Param('clienteId', ParseUUIDPipe) clienteId: string,
    @Body() dto: ArquivoTermoDto,
  ) {
    return this.clientes.anexarTermo(usuario, empresaId, clienteId, dto);
  }

  @Permissoes('cliente:ler')
  @Get(':clienteId/consentimento/termo')
  verTermo(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
    @Param('clienteId', ParseUUIDPipe) clienteId: string,
  ) {
    return this.clientes.verTermo(usuario, empresaId, clienteId);
  }

  /** Revogação pedida pelo cliente à empresa (RN41). */
  @Permissoes('cliente:editar')
  @Auditar({
    acao: 'CONSENTIMENTO_REVOGADO',
    entidade: 'Cliente',
    nivel: 'ALERTA',
    parametro: 'clienteId',
  })
  @Post(':clienteId/consentimento/revogacao')
  @HttpCode(204)
  async revogar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
    @Param('clienteId', ParseUUIDPipe) clienteId: string,
  ): Promise<void> {
    await this.clientes.revogarPelaEmpresa(usuario, empresaId, clienteId);
  }
}

/** Página pública do termo do cliente sem conta (UX-01, seção 4.1). */
@Controller('consentimentos-clientes/:token')
export class ConsentimentoClienteController {
  constructor(private readonly clientes: ClientesService) {}

  @Publica()
  @Get()
  abrir(@Param('token') token: string) {
    return this.clientes.abrirTermo(token);
  }

  @Publica()
  @Post('aceite')
  @HttpCode(204)
  async aceitar(
    @Param('token') token: string,
    @Ip() ip: string,
  ): Promise<void> {
    await this.clientes.aceitar(token, ip);
  }

  @Publica()
  @Post('revogacao')
  @HttpCode(204)
  async revogar(@Param('token') token: string): Promise<void> {
    await this.clientes.revogarPeloLink(token);
  }
}
