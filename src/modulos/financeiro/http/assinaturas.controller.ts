import { Controller, Get, Post } from '@nestjs/common';
import {
  Permissoes,
  SomenteTutor,
} from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Auditar } from '../../../compartilhado/auditoria/auditoria.interceptor';
import {
  Assinatura,
  AssinaturasService,
  SituacaoPlano,
} from '../aplicacao/assinaturas.service';

/** Assinatura PANTERA do tutor (ADR-010): o pagamento usa POST /pagamentos com assinaturaId. */
@SomenteTutor()
@Permissoes('pagamento:realizar')
@Controller('assinaturas')
export class AssinaturasController {
  constructor(private readonly assinaturas: AssinaturasService) {}

  @Get('atual')
  situacao(
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<SituacaoPlano> {
    return this.assinaturas.situacao(usuario);
  }

  @Post()
  assinar(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<Assinatura> {
    return this.assinaturas.assinar(usuario);
  }

  @Auditar({
    acao: 'ASSINATURA_CANCELADA',
    entidade: 'Assinatura',
    nivel: 'INFO',
  })
  @Post('atual/cancelamento')
  cancelar(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<Assinatura> {
    return this.assinaturas.cancelar(usuario);
  }
}
