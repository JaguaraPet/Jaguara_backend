import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import {
  Permissoes,
  SomenteTutor,
} from '../../../compartilhado/auth/permissoes';
import {
  Publica,
  UsuarioAtual,
} from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import type { Ambiente } from '../../../compartilhado/config/ambiente';
import {
  CalendarioExternoService,
  SituacaoCalendario,
} from '../aplicacao/calendario-externo.service';

/** Sincronização com o Google Agenda (UC-09, RN13). */
@Controller()
export class CalendarioExternoController {
  constructor(
    private readonly calendario: CalendarioExternoService,
    private readonly config: ConfigService<Ambiente, true>,
  ) {}

  @SomenteTutor()
  @Permissoes('rotina:ler')
  @Get('calendario-externo')
  situacao(
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<SituacaoCalendario | null> {
    return this.calendario.situacao(usuario);
  }

  @SomenteTutor()
  @Permissoes('rotina:editar')
  @Post('calendario-externo/google/autorizacao')
  autorizar(@UsuarioAtual() usuario: UsuarioAutenticado): { url: string } {
    return this.calendario.iniciarAutorizacao(usuario);
  }

  /** O navegador volta do Google para cá; a API devolve o tutor para o app com o resultado. */
  @Publica()
  @Get('calendario-externo/google/retorno')
  async retorno(
    @Query() q: { code?: string; state?: string; error?: string },
    @Res() resposta: Response,
  ): Promise<void> {
    const resultado = await this.calendario.concluirAutorizacao(q);
    const app = this.config.get('URL_APP', { infer: true }).replace(/\/$/, '');
    resposta.redirect(302, `${app}/calendario?resultado=${resultado}`);
  }

  @SomenteTutor()
  @Permissoes('rotina:editar')
  @Post('pets/:petId/calendario-externo/sincronizacao')
  sincronizar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
  ) {
    return this.calendario.sincronizar(usuario, petId);
  }

  @SomenteTutor()
  @Permissoes('rotina:editar')
  @Delete('calendario-externo')
  @HttpCode(204)
  async desconectar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<void> {
    await this.calendario.desconectar(usuario);
  }
}
