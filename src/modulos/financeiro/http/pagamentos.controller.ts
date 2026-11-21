import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  Permissoes,
  SomenteTutor,
} from '../../../compartilhado/auth/permissoes';
import {
  Publica,
  UsuarioAtual,
} from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import type { Ambiente } from '../../../compartilhado/config/ambiente';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { Pagamento, PagamentosService } from '../aplicacao/pagamentos.service';
import { assinaturaValida } from '../dominio/pagamento';
import type { MetodoPagamento } from '../dominio/pagamento';

export class NovoPagamentoDto {
  @IsOptional()
  @IsUUID('all', { message: 'Escolha o agendamento' })
  agendamentoId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'Escolha a assinatura' })
  assinaturaId?: string;

  @IsIn(['CARTAO_CREDITO', 'CARTAO_DEBITO', 'PIX', 'BOLETO'], {
    message: 'Escolha o meio de pagamento',
  })
  metodo: MetodoPagamento;

  /** Token do cartão gerado no app pelo formulário seguro do gateway. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  tokenCartao?: string;

  /** Bandeira informada pelo formulário do gateway (ex.: visa, master, debvisa). */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  bandeiraCartao?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  parcelas?: number;
}

@Controller()
export class PagamentosController {
  constructor(
    private readonly pagamentos: PagamentosService,
    private readonly config: ConfigService<Ambiente, true>,
  ) {}

  /** UC-44: o tutor paga um serviço agendado com PIX ou cartão. */
  @SomenteTutor()
  @Permissoes('pagamento:realizar')
  @Post('pagamentos')
  iniciar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() dto: NovoPagamentoDto,
  ): Promise<Pagamento> {
    return this.pagamentos.iniciar(usuario, dto);
  }

  /**
   * Webhook do gateway (ARQ-03, seção 3.1): a assinatura é conferida antes de tudo (RN36) e o
   * status vem de nova consulta ao gateway, nunca do corpo do evento.
   */
  @Publica()
  @Post('webhooks/pagamentos')
  @HttpCode(200)
  async webhook(
    @Headers('x-signature') assinatura: string | undefined,
    @Headers('x-request-id') requestId: string | undefined,
    @Query() consulta: Record<string, unknown>,
    @Body() corpo: { type?: unknown; data?: { id?: unknown } } | undefined,
  ): Promise<{ recebido: true }> {
    const idConsulta = consulta['data.id'];
    const dataId =
      typeof idConsulta === 'string'
        ? idConsulta
        : typeof corpo?.data?.id === 'string' ||
            typeof corpo?.data?.id === 'number'
          ? String(corpo.data.id)
          : undefined;
    const segredo = this.config.get('MP_WEBHOOK_SEGREDO', { infer: true });
    if (!assinaturaValida(segredo, { assinatura, requestId }, dataId)) {
      throw Erros.naoAutenticado('Assinatura do webhook inválida.');
    }
    const tipo = consulta.type ?? corpo?.type;
    if (tipo === 'payment' && dataId) await this.pagamentos.sincronizar(dataId);
    return { recebido: true };
  }
}
