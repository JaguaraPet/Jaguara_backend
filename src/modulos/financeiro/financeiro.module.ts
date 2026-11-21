import { Module } from '@nestjs/common';
import { ComunicacaoModule } from '../comunicacao/comunicacao.module';
import { NotificacaoModule } from '../notificacao/notificacao.module';
import { PetModule } from '../pet/pet.module';
import { DespesasService } from './aplicacao/despesas.service';
import { PagamentosService } from './aplicacao/pagamentos.service';
import { DespesasController } from './http/despesas.controller';
import { PagamentosController } from './http/pagamentos.controller';
import { provedorGateway } from './infra/gateway.provider';

@Module({
  imports: [PetModule, NotificacaoModule, ComunicacaoModule],
  controllers: [PagamentosController, DespesasController],
  providers: [PagamentosService, DespesasService, provedorGateway],
  exports: [PagamentosService],
})
export class FinanceiroModule {}
