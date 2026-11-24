import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  Autenticado,
  Permissoes,
  SomenteTutor,
} from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import {
  AcompanhamentoSolicitacoesService,
  DetalheSolicitacao,
  MudancaStatus,
} from '../aplicacao/acompanhamento-solicitacoes.service';

/** O tutor acompanha e cancela as próprias solicitações (UC-42, RN38). */
@SomenteTutor()
@Controller()
export class AcompanhamentoController {
  constructor(
    private readonly acompanhamento: AcompanhamentoSolicitacoesService,
  ) {}

  @Autenticado()
  @Get('minhas-solicitacoes')
  listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<DetalheSolicitacao[]> {
    return this.acompanhamento.listar(usuario);
  }

  @Autenticado()
  @Get('solicitacoes/:solicitacaoId')
  detalhar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('solicitacaoId', ParseUUIDPipe) solicitacaoId: string,
  ): Promise<DetalheSolicitacao> {
    return this.acompanhamento.detalhar(usuario, solicitacaoId);
  }

  @Autenticado()
  @Get('solicitacoes/:solicitacaoId/historico')
  async historico(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('solicitacaoId', ParseUUIDPipe) solicitacaoId: string,
  ): Promise<MudancaStatus[]> {
    return (await this.acompanhamento.detalhar(usuario, solicitacaoId))
      .historico;
  }

  @Permissoes('solicitacao:criar')
  @Post('solicitacoes/:solicitacaoId/cancelamento')
  @HttpCode(204)
  async cancelar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('solicitacaoId', ParseUUIDPipe) solicitacaoId: string,
  ): Promise<void> {
    await this.acompanhamento.cancelar(usuario, solicitacaoId);
  }
}
