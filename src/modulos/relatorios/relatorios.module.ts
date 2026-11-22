import { Module } from '@nestjs/common';
import { IndicadoresService } from './aplicacao/indicadores.service';
import { RelatoriosEmpresaService } from './aplicacao/relatorios-empresa.service';
import { IndicadoresController } from './http/indicadores.controller';
import { RelatoriosEmpresaController } from './http/relatorios-empresa.controller';

@Module({
  controllers: [RelatoriosEmpresaController, IndicadoresController],
  providers: [RelatoriosEmpresaService, IndicadoresService],
})
export class RelatoriosModule {}
