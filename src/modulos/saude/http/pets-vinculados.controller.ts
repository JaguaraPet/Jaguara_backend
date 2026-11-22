import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  Autenticado,
  SomenteEnterprise,
} from '../../../compartilhado/auth/permissoes';
import { UsuarioAtual } from '../../../compartilhado/auth/usuario-autenticado';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import {
  PetsVinculadosService,
  PetVinculado,
} from '../aplicacao/pets-vinculados.service';

/** Pets vinculados (UC-20) e perfil do pet para a empresa (UC-22). */
/* A permissão (cliente:ler ou atendimento:ler) é conferida no serviço. */
@Autenticado()
@SomenteEnterprise()
@Controller('empresas/:empresaId')
export class PetsVinculadosController {
  constructor(private readonly vinculados: PetsVinculadosService) {}

  @Get('pets-vinculados')
  listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
  ): Promise<PetVinculado[]> {
    return this.vinculados.listar(usuario, empresaId);
  }

  @Get('pets/:petId/perfil')
  perfil(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
    @Param('petId', ParseUUIDPipe) petId: string,
  ) {
    return this.vinculados.perfil(usuario, empresaId, petId);
  }
}
