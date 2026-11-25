import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Ambiente } from '../config/ambiente';
import { assinarUrl } from './url-assinada';
import type { CredenciaisS3 } from './url-assinada';

/** Validade das URLs de envio e de download (ARQ-03, seção 3.6). */
export const VALIDADE_URL_SEGUNDOS = 300;

/**
 * Armazenamento de arquivos compatível com S3 (ADR-005): a API guarda só a chave do arquivo
 * e entrega URLs assinadas de curta duração; o endereço do bucket não sai da API sem assinatura.
 */
@Injectable()
export class Armazenamento {
  private readonly credenciais: CredenciaisS3;

  constructor(config: ConfigService<Ambiente, true>) {
    this.credenciais = {
      endpoint: config.get('S3_ENDPOINT', { infer: true }),
      regiao: config.get('S3_REGIAO', { infer: true }),
      bucket: config.get('S3_BUCKET', { infer: true }),
      chaveAcesso: config.get('S3_ACCESS_KEY', { infer: true }),
      chaveSecreta: config.get('S3_SECRET_KEY', { infer: true }),
    };
  }

  /** URL para o aparelho enviar o arquivo com PUT. */
  urlEnvio(chave: string, agora = new Date()): string {
    return assinarUrl(this.credenciais, {
      metodo: 'PUT',
      chave,
      expiraSegundos: VALIDADE_URL_SEGUNDOS,
      agora,
    });
  }

  /** URL de leitura para mostrar o arquivo na tela (por exemplo, uma foto). */
  urlLeitura(chave: string, agora = new Date()): string {
    return assinarUrl(this.credenciais, {
      metodo: 'GET',
      chave,
      expiraSegundos: VALIDADE_URL_SEGUNDOS,
      agora,
    });
  }

  /** URL de download que já baixa com o nome original do arquivo. */
  urlDownload(chave: string, nomeArquivo: string, agora = new Date()): string {
    const nome = nomeArquivo.replace(/["\\\r\n]/g, '_');
    return assinarUrl(this.credenciais, {
      metodo: 'GET',
      chave,
      expiraSegundos: VALIDADE_URL_SEGUNDOS,
      agora,
      parametros: {
        'response-content-disposition': `attachment; filename="${nome}"`,
      },
    });
  }
}

@Global()
@Module({ providers: [Armazenamento], exports: [Armazenamento] })
export class ArquivosModule {}
