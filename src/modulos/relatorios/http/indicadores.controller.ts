import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  Permissoes,
  SomenteEnterprise,
} from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import {
  Indicadores,
  IndicadoresService,
} from '../aplicacao/indicadores.service';
import { PeriodoDto } from './relatorios-empresa.controller';

/** Indicadores de BI da empresa (UC-17, RN21). */
@SomenteEnterprise()
@Permissoes('relatorio:ler')
@Controller('empresas/:empresaId/indicadores')
export class IndicadoresController {
  constructor(private readonly indicadores: IndicadoresService) {}

  @Get()
  consultar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
    @Query() periodo: PeriodoDto,
  ): Promise<Indicadores> {
    return this.indicadores.consultar(usuario, empresaId, periodo);
  }
}
