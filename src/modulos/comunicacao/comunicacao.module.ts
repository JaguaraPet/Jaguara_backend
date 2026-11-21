import Anthropic from '@anthropic-ai/sdk';
import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Ambiente } from '../../compartilhado/config/ambiente';
import { PetModule } from '../pet/pet.module';
import { AssistenteService } from './aplicacao/assistente.service';
import { CanalTempoReal } from './aplicacao/canal-tempo-real';
import { ConversasService } from './aplicacao/conversas.service';
import { PROVEDOR_ASSISTENTE } from './dominio/assistente';
import { ChatGateway } from './http/chat.gateway';
import { ConversasController } from './http/conversas.controller';
import { AssistenteAnthropic } from './infra/assistente-anthropic';
import { AssistenteSimulado } from './infra/assistente-simulado';

@Module({
  imports: [PetModule],
  controllers: [ConversasController],
  providers: [
    CanalTempoReal,
    ConversasService,
    AssistenteService,
    ChatGateway,
    {
      // Com chave e modelo usa o provedor de IA; sem eles, respostas simuladas (ARQ-03, seção 3.5).
      provide: PROVEDOR_ASSISTENTE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Ambiente, true>) => {
        const chave = config.get('ANTHROPIC_API_KEY', { infer: true });
        const modelo = config.get('IA_MODELO', { infer: true });
        if (!chave || !modelo) {
          new Logger('Assistente').warn(
            'ANTHROPIC_API_KEY ou IA_MODELO ausente: o assistente virtual responde simulado.',
          );
          return new AssistenteSimulado();
        }
        return new AssistenteAnthropic(
          new Anthropic({ apiKey: chave, timeout: 60_000, maxRetries: 2 }),
          modelo,
        );
      },
    },
  ],
  exports: [CanalTempoReal, ConversasService],
})
export class ComunicacaoModule {}
