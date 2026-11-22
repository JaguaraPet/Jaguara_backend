import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { Autenticado } from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { LinhaDoTempoService } from '../aplicacao/linha-do-tempo.service';
import type { ItemLinhaDoTempo } from '../dominio/linha-do-tempo';

/** Linha do tempo do pet (UC-35): tutor responsável ou empresa com LINHA_DO_TEMPO. */
@Autenticado()
@Controller('pets/:petId/linha-do-tempo')
export class LinhaDoTempoController {
  constructor(private readonly linhaDoTempo: LinhaDoTempoService) {}

  @Get()
  consultar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('petId', ParseUUIDPipe) petId: string,
  ): Promise<ItemLinhaDoTempo[]> {
    return this.linhaDoTempo.consultar(usuario, petId);
  }
}
