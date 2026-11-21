import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { PublicadorWebhook } from './publicador-webhook';
import { FILA_WEBHOOKS } from './webhook';

/** Publicação de eventos para webhooks de saída, disponível para todos os módulos. */
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: FILA_WEBHOOKS })],
  providers: [PublicadorWebhook],
  exports: [PublicadorWebhook],
})
export class WebhooksModule {}
