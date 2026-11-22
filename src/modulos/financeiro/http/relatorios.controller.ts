import {
  Controller,
  Get,
  Headers,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';
import {
  Permissoes,
  SomenteTutor,
} from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import {
  RelatorioDespesas,
  RelatorioDespesasService,
} from '../aplicacao/relatorio-despesas.service';

const DATA = { strict: true };

export class FiltroRelatorioDespesasDto {
  @IsOptional()
  @IsUUID('all', { message: 'Pet inválido' })
  petId?: string;

  @IsDateString(DATA, { message: 'Informe a data inicial (AAAA-MM-DD)' })
  de: string;

  @IsDateString(DATA, { message: 'Informe a data final (AAAA-MM-DD)' })
  ate: string;
}

@Controller('relatorios')
export class RelatoriosController {
  constructor(private readonly relatorio: RelatorioDespesasService) {}

  /** UC-07: JSON para a tela ou PDF (RN11), conforme o cabeçalho Accept. */
  @SomenteTutor()
  @Permissoes('rotina:ler')
  @Get('despesas')
  async despesas(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Query() filtro: FiltroRelatorioDespesasDto,
    @Headers('accept') aceita: string | undefined,
    @Res({ passthrough: true }) resposta: Response,
  ): Promise<RelatorioDespesas | StreamableFile> {
    if (!aceita?.includes('application/pdf')) {
      return this.relatorio.gerar(usuario, filtro, 'TELA');
    }
    const pdf = await this.relatorio.pdf(usuario, filtro);
    resposta.setHeader('Content-Type', 'application/pdf');
    resposta.setHeader(
      'Content-Disposition',
      `attachment; filename="despesas-${filtro.de}-a-${filtro.ate}.pdf"`,
    );
    return new StreamableFile(pdf);
  }
}
