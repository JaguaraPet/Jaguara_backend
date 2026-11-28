import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Ambiente } from '../../compartilhado/config/ambiente';
import { NotificacaoModule } from '../notificacao/notificacao.module';
import { PetModule } from '../pet/pet.module';
import { AlimentacaoService } from './aplicacao/alimentacao.service';
import { CalendarioExternoService } from './aplicacao/calendario-externo.service';
import { EventosService } from './aplicacao/eventos.service';
import { AlimentacaoController } from './http/alimentacao.controller';
import { CalendarioExternoController } from './http/calendario-externo.controller';
import { EventosController } from './http/eventos.controller';
import { RotinasController } from './http/rotinas.controller';
import { HojeTutorService } from './aplicacao/hoje-tutor.service';
import { RotinasService } from './aplicacao/rotinas.service';
import {
  CalendarioGoogle,
  CalendarioSimulado,
  PROVEDOR_CALENDARIO,
} from './infra/provedor-calendario';

@Module({
  imports: [PetModule, NotificacaoModule],
  controllers: [
    EventosController,
    AlimentacaoController,
    CalendarioExternoController,
    RotinasController,
  ],
  providers: [
    EventosService,
    AlimentacaoService,
    CalendarioExternoService,
    RotinasService,
    HojeTutorService,
    {
      // Sem as credenciais do Google, o calendário é simulado (desenvolvimento e testes).
      provide: PROVEDOR_CALENDARIO,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Ambiente, true>) => {
        const id = config.get('GOOGLE_CLIENT_ID', { infer: true });
        const segredo = config.get('GOOGLE_CLIENT_SECRET', { infer: true });
        return id && segredo
          ? new CalendarioGoogle(id, segredo)
          : new CalendarioSimulado();
      },
    },
  ],
})
export class RotinaModule {}
