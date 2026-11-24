import { Injectable } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { tokenExpoValido } from '../infra/envio-push-expo';

/** Aparelhos que recebem push pelo Expo (UC-31). Um token é de um usuário só. */
@Injectable()
export class DispositivosService {
  constructor(private readonly prisma: PrismaService) {}

  /** Registra o aparelho no login; o mesmo aparelho com outra conta passa para a conta atual. */
  async registrar(
    usuario: UsuarioAutenticado,
    dados: { token: string; plataforma: string },
  ): Promise<void> {
    if (!tokenExpoValido(dados.token)) {
      throw Erros.dadosInvalidos('token', 'Token de push do Expo inválido.');
    }
    await this.prisma.dispositivoPush.upsert({
      where: { token: dados.token },
      update: { usuarioId: usuario.sub, plataforma: dados.plataforma },
      create: {
        token: dados.token,
        plataforma: dados.plataforma,
        usuarioId: usuario.sub,
      },
    });
  }

  /** Tira o aparelho na saída da conta, para o push não chegar a quem saiu. */
  async remover(usuario: UsuarioAutenticado, token: string): Promise<void> {
    await this.prisma.dispositivoPush.deleteMany({
      where: { token, usuarioId: usuario.sub },
    });
  }
}
