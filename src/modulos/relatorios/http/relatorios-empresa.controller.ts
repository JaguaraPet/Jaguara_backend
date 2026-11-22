import {
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { IsDateString } from 'class-validator';
import {
  Permissoes,
  SomenteEnterprise,
} from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import {
  RelatorioEmpresa,
  RelatoriosEmpresaService,
} from '../aplicacao/relatorios-empresa.service';
import type { TipoRelatorioEmpresa } from '../dominio/relatorio-empresa';

const DATA = { strict: true };
const TIPOS: TipoRelatorioEmpresa[] = ['atendimentos', 'financeiro'];

export class PeriodoDto {
  @IsDateString(DATA, { message: 'Informe a data inicial (AAAA-MM-DD)' })
  de: string;

  @IsDateString(DATA, { message: 'Informe a data final (AAAA-MM-DD)' })
  ate: string;
}

/** Relatórios da empresa (UC-18, RN22): JSON para a tela ou PDF pelo Accept. */
@SomenteEnterprise()
@Permissoes('relatorio:ler')
@Controller('empresas/:empresaId/relatorios')
export class RelatoriosEmpresaController {
  constructor(private readonly relatorios: RelatoriosEmpresaService) {}

  @Get(':tipo')
  async gerar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
    @Param('tipo') tipo: string,
    @Query() periodo: PeriodoDto,
    @Headers('accept') aceita: string | undefined,
    @Res({ passthrough: true }) resposta: Response,
  ): Promise<RelatorioEmpresa | StreamableFile> {
    if (!TIPOS.includes(tipo as TipoRelatorioEmpresa)) {
      throw Erros.naoEncontrado('Relatório não encontrado');
    }
    const t = tipo as TipoRelatorioEmpresa;
    if (!aceita?.includes('application/pdf')) {
      return this.relatorios.gerar(usuario, empresaId, t, periodo, 'TELA');
    }
    const pdf = await this.relatorios.pdf(usuario, empresaId, t, periodo);
    resposta.setHeader('Content-Type', 'application/pdf');
    resposta.setHeader(
      'Content-Disposition',
      `attachment; filename="${t}-${periodo.de}-a-${periodo.ate}.pdf"`,
    );
    return new StreamableFile(pdf);
  }
}
