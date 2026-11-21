import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Put,
} from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, Max, Min } from 'class-validator';
import {
  Autenticado,
  Permissoes,
} from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import {
  ConfiguracoesNotificacaoService,
  Notificacao,
} from '../aplicacao/configuracoes-notificacao.service';
import { ANTECEDENCIA_MAXIMA, TIPOS_EVENTO } from '../dominio/programacao';
import type { Canal, Configuracao, TipoEvento } from '../dominio/programacao';

export class ConfiguracaoDto {
  @IsIn(['PUSH', 'EMAIL', 'SMS'], { message: 'Escolha push ou e-mail' })
  canal: Canal;

  @IsInt({ message: 'Informe a antecedência em minutos' })
  @Min(0, { message: 'A antecedência mínima é zero' })
  @Max(ANTECEDENCIA_MAXIMA, { message: 'A antecedência máxima é de 7 dias' })
  antecedenciaMinutos: number;

  @IsBoolean({ message: 'Informe se a notificação fica ligada' })
  ativa: boolean;
}

const TIPO = Object.fromEntries(TIPOS_EVENTO.map((t) => [t, t]));

@Controller('notificacoes')
export class NotificacoesController {
  constructor(
    private readonly configuracoes: ConfiguracoesNotificacaoService,
  ) {}

  @Autenticado()
  @Get()
  listar(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<Notificacao[]> {
    return this.configuracoes.notificacoes(usuario);
  }

  @Permissoes('notificacao:configurar')
  @Get('configuracoes')
  configuracoesDoUsuario(
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<Configuracao[]> {
    return this.configuracoes.listar(usuario);
  }

  /** RN37: canal, antecedência e liga/desliga por tipo de compromisso. */
  @Permissoes('notificacao:configurar')
  @Put('configuracoes/:tipoEvento')
  salvar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('tipoEvento', new ParseEnumPipe(TIPO)) tipoEvento: TipoEvento,
    @Body() dto: ConfiguracaoDto,
  ): Promise<Configuracao> {
    return this.configuracoes.salvar(usuario, tipoEvento, dto);
  }
}
