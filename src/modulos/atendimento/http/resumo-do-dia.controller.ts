import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  Permissoes,
  SomenteEnterprise,
} from '../../../compartilhado/auth/permissoes';
import {
  UsuarioAtual,
  type UsuarioAutenticado,
} from '../../../compartilhado/auth/usuario-autenticado';
import { ResumoDoDiaService } from '../aplicacao/resumo-do-dia.service';

@Controller()
export class ResumoDoDiaController {
  constructor(private readonly resumo: ResumoDoDiaService) {}

  /** Tela "Hoje": agenda do dia, pedidos, cobranças em aberto e vacinas vencendo. */
  @SomenteEnterprise()
  @Permissoes('agenda:ler')
  @Get('empresas/:empresaId/hoje')
  hoje(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
  ) {
    return this.resumo.resumo(usuario, empresaId);
  }
}
