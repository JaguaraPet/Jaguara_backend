import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  Permissoes,
  SomenteAdministrador,
} from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Auditar } from '../../../compartilhado/auditoria/auditoria.interceptor';
import {
  Integracao,
  IntegracoesService,
  Webhook,
} from '../aplicacao/integracoes.service';
import type { TipoIntegracao } from '../aplicacao/integracoes.service';

const TIPOS: TipoIntegracao[] = [
  'CALENDARIO',
  'PAGAMENTO',
  'PLATAFORMA_VETERINARIA',
  'NOTIFICACAO',
  'OUTRA',
];

export class IntegracaoDto {
  @IsString()
  @IsNotEmpty({ message: 'Dê um nome à integração' })
  @MaxLength(255)
  nome: string;

  @IsIn(TIPOS, { message: 'Escolha o tipo da integração' })
  tipo: TipoIntegracao;

  @IsString({ message: 'Informe o endereço do serviço' })
  @MaxLength(2048)
  endpointUrl: string;

  /** Token ou chave do provedor; gravado cifrado e nunca devolvido. */
  @IsString({ message: 'Informe as credenciais' })
  @IsNotEmpty({ message: 'Informe as credenciais' })
  @MaxLength(150)
  credenciais: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  parametros?: string;
}

export class AlteracaoIntegracaoDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  nome?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  endpointUrl?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  credenciais?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  parametros?: string;

  @IsOptional()
  @IsBoolean()
  ativa?: boolean;
}

export class WebhookDto {
  @IsString({ message: 'Informe a URL HTTPS' })
  @MaxLength(2048)
  url: string;

  @IsArray({ message: 'Escolha os eventos' })
  @ArrayMinSize(1, { message: 'Escolha pelo menos um evento' })
  @IsString({ each: true })
  eventos: string[];

  @IsString({ message: 'Escolha a autenticação' })
  metodoAutenticacao: string;

  /** Opcional: sem segredo, a API gera um. */
  @IsOptional()
  @IsString()
  @MinLength(16, { message: 'O segredo precisa de pelo menos 16 caracteres' })
  @MaxLength(64)
  segredo?: string;

  @IsOptional()
  @IsUUID()
  integracaoId?: string;
}

export class AlteracaoWebhookDto {
  @IsOptional()
  @IsBoolean()
  ativo?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  eventos?: string[];
}

/** Integrações (UC-27) e webhooks (UC-30): só administradores com admin:integracoes (RN33). */
@SomenteAdministrador()
@Permissoes('admin:integracoes')
@Controller('admin')
export class IntegracoesController {
  constructor(private readonly integracoes: IntegracoesService) {}

  @Get('integracoes')
  listarIntegracoes(): Promise<Integracao[]> {
    return this.integracoes.integracoes();
  }

  @Auditar({
    acao: 'INTEGRACAO_CRIADA',
    entidade: 'Integracao',
    nivel: 'CRITICO',
  })
  @Post('integracoes')
  criarIntegracao(
    @UsuarioAtual() admin: UsuarioAutenticado,
    @Body() dto: IntegracaoDto,
  ): Promise<Integracao> {
    return this.integracoes.criarIntegracao(admin, dto);
  }

  @Auditar({
    acao: 'INTEGRACAO_ALTERADA',
    entidade: 'Integracao',
    nivel: 'CRITICO',
    parametro: 'integracaoId',
  })
  @Patch('integracoes/:integracaoId')
  alterarIntegracao(
    @Param('integracaoId', ParseUUIDPipe) id: string,
    @Body() dto: AlteracaoIntegracaoDto,
  ): Promise<Integracao> {
    return this.integracoes.alterarIntegracao(id, dto);
  }

  @Post('integracoes/:integracaoId/teste')
  @HttpCode(200)
  testarIntegracao(@Param('integracaoId', ParseUUIDPipe) id: string) {
    return this.integracoes.testarIntegracao(id);
  }

  @Get('webhooks')
  listarWebhooks(): Promise<Webhook[]> {
    return this.integracoes.webhooks();
  }

  @Auditar({ acao: 'WEBHOOK_CRIADO', entidade: 'Webhook', nivel: 'CRITICO' })
  @Post('webhooks')
  criarWebhook(
    @UsuarioAtual() admin: UsuarioAutenticado,
    @Body() dto: WebhookDto,
  ): Promise<Webhook> {
    return this.integracoes.criarWebhook(admin, dto);
  }

  @Auditar({
    acao: 'WEBHOOK_ALTERADO',
    entidade: 'Webhook',
    nivel: 'CRITICO',
    parametro: 'webhookId',
  })
  @Patch('webhooks/:webhookId')
  alterarWebhook(
    @Param('webhookId', ParseUUIDPipe) id: string,
    @Body() dto: AlteracaoWebhookDto,
  ): Promise<Webhook> {
    return this.integracoes.alterarWebhook(id, dto);
  }
}
