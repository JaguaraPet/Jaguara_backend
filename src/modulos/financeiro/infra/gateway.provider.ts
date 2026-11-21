import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Ambiente } from '../../../compartilhado/config/ambiente';
import { GATEWAY_PAGAMENTO } from '../dominio/pagamento';
import { GatewayMercadoPago } from './gateway-mercado-pago';
import { GatewaySimulado } from './gateway-simulado';

/** Com MP_ACCESS_TOKEN usa o Mercado Pago; sem token, o gateway simulado (ARQ-03, seção 3.1). */
export const provedorGateway: Provider = {
  provide: GATEWAY_PAGAMENTO,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Ambiente, true>) => {
    const token = config.get('MP_ACCESS_TOKEN', { infer: true });
    if (!token) {
      new Logger('Pagamentos').warn(
        'MP_ACCESS_TOKEN ausente: pagamentos usam o gateway simulado.',
      );
      return new GatewaySimulado();
    }
    const urlApi = config.get('URL_API_PUBLICA', { infer: true });
    return new GatewayMercadoPago(
      token,
      urlApi
        ? `${urlApi.replace(/\/$/, '')}/v1/webhooks/pagamentos`
        : undefined,
    );
  },
};
