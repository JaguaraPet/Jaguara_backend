import { Module } from '@nestjs/common';
import { RelatoriosEmpresaService } from './aplicacao/relatorios-empresa.service';
import { RelatoriosEmpresaController } from './http/relatorios-empresa.controller';

@Module({
  controllers: [RelatoriosEmpresaController],
  providers: [RelatoriosEmpresaService],
})
export class RelatoriosModule {}
