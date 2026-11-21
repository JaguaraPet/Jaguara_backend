import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Permissoes } from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import {
  Conversa,
  ConversasService,
  Mensagem,
} from '../aplicacao/conversas.service';
import { TAMANHO_MAXIMO_MENSAGEM } from '../dominio/conversa';
import type { TipoConversa } from '../dominio/conversa';

export class NovaConversaDto {
  @IsIn(['EMPRESA', 'ASSISTENTE_VIRTUAL'], {
    message: 'Escolha EMPRESA ou ASSISTENTE_VIRTUAL',
  })
  tipo: TipoConversa;

  @IsOptional()
  @IsUUID('all', { message: 'Escolha a empresa' })
  empresaId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'Escolha o pet' })
  petId?: string;
}

export class NovaMensagemDto {
  @IsString({ message: 'Escreva a mensagem' })
  @MaxLength(TAMANHO_MAXIMO_MENSAGEM, {
    message: `A mensagem pode ter até ${TAMANHO_MAXIMO_MENSAGEM} caracteres`,
  })
  conteudo: string;
}

export class HistoricoDto {
  @IsOptional()
  @IsDateString({}, { message: 'Informe a data e a hora' })
  antes?: string;
}

/** Chat do UC-43; o envio também existe pelo WebSocket (ChatGateway). */
@Permissoes('chat:usar')
@Controller('conversas')
export class ConversasController {
  constructor(private readonly conversas: ConversasService) {}

  @Get()
  listar(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<Conversa[]> {
    return this.conversas.listar(usuario);
  }

  @Post()
  iniciar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() dto: NovaConversaDto,
  ): Promise<Conversa> {
    return this.conversas.iniciar(usuario, dto);
  }

  @Get(':conversaId/mensagens')
  mensagens(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('conversaId', ParseUUIDPipe) conversaId: string,
    @Query() filtro: HistoricoDto,
  ): Promise<Mensagem[]> {
    return this.conversas.mensagens(usuario, conversaId, filtro.antes);
  }

  @Post(':conversaId/mensagens')
  enviar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('conversaId', ParseUUIDPipe) conversaId: string,
    @Body() dto: NovaMensagemDto,
  ): Promise<Mensagem> {
    return this.conversas.enviar(usuario, conversaId, dto.conteudo);
  }

  @Post(':conversaId/encerramento')
  @HttpCode(204)
  async encerrar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('conversaId', ParseUUIDPipe) conversaId: string,
  ): Promise<void> {
    await this.conversas.encerrar(usuario, conversaId);
  }
}
