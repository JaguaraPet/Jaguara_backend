import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ErroNegocio } from './erro-negocio';

export interface Problema {
  type: string;
  title: string;
  status: number;
  detail?: string;
  codigo?: string;
  campos?: { campo: string; mensagem: string }[];
}

/** Converte qualquer erro no formato application/problem+json (RFC 9457). */
@Catch()
export class ProblemaFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemaFilter.name);

  catch(erro: unknown, host: ArgumentsHost) {
    const resposta = host.switchToHttp().getResponse<Response>();
    const problema = this.montar(erro);
    resposta
      .status(problema.status)
      .type('application/problem+json')
      .json(problema);
  }

  private montar(erro: unknown): Problema {
    if (erro instanceof ErroNegocio) {
      return {
        type: `https://jaguarapet.com.br/erros/${erro.codigo.toLowerCase()}`,
        title: erro.titulo,
        status: erro.status,
        detail: erro.detalhe,
        codigo: erro.codigo,
      };
    }
    if (erro instanceof HttpException) {
      const status = erro.getStatus();
      const corpo = erro.getResponse();
      const campos =
        typeof corpo === 'object' && corpo && 'campos' in corpo
          ? (corpo as { campos: Problema['campos'] }).campos
          : undefined;
      return {
        type: 'about:blank',
        title: campos ? 'Dados inválidos' : erro.message,
        status,
        codigo: campos ? 'DADOS_INVALIDOS' : undefined,
        campos,
      };
    }
    this.logger.error(erro);
    return {
      type: 'about:blank',
      title: 'Erro interno',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
    };
  }
}
