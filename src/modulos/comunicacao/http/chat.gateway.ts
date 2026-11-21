import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { isUUID } from 'class-validator';
import type { Namespace, Socket } from 'socket.io';
import { SessoesRevogadas } from '../../../compartilhado/auth/sessoes-revogadas';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import { CanalTempoReal } from '../aplicacao/canal-tempo-real';
import { ConversasService, Mensagem } from '../aplicacao/conversas.service';
import { salaEmpresa, salaUsuario } from '../dominio/conversa';

type SocketAutenticado = Socket;

/** Dados que o gateway guarda em cada conexão. */
const dadosDa = (cliente: Socket) =>
  cliente.data as { usuario?: UsuarioAutenticado };

type Resposta =
  | { ok: true; mensagem: Mensagem }
  | { ok: false; codigo: string; detalhe: string };

/**
 * Tempo real do chat (ADR-011): o cliente conecta em /tempo-real com o access token em
 * `auth.token`, entra na sala do usuário e, na empresa, na sala da empresa.
 */
@WebSocketGateway({
  namespace: '/tempo-real',
  cors: { origin: (process.env.URL_WEB ?? '').split(',').filter(Boolean) },
})
export class ChatGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly log = new Logger(ChatGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly revogadas: SessoesRevogadas,
    private readonly conversas: ConversasService,
    private readonly canal: CanalTempoReal,
  ) {}

  afterInit(servidor: Namespace) {
    this.canal.registrar(servidor);
  }

  /** Mesmas regras da camada de acesso: token válido, sessão ativa e permissão chat:usar. */
  async handleConnection(cliente: SocketAutenticado) {
    const token: unknown = cliente.handshake.auth?.token;
    try {
      if (typeof token !== 'string') throw new Error('sem token');
      const usuario = await this.jwt.verifyAsync<UsuarioAutenticado>(token);
      if (await this.revogadas.estaRevogada(usuario.sid))
        throw new Error('sessão revogada');
      if (!usuario.permissoes.includes('chat:usar'))
        throw new Error('sem permissão');
      dadosDa(cliente).usuario = usuario;
      await cliente.join(salaUsuario(usuario.sub));
      if (usuario.empresaId) await cliente.join(salaEmpresa(usuario.empresaId));
      cliente.emit('conectado', { usuarioId: usuario.sub });
    } catch (erro) {
      this.log.debug(`Conexão recusada: ${String(erro)}`);
      cliente.emit('erro', {
        codigo: 'NAO_AUTENTICADO',
        detalhe: 'Envie um access token válido em auth.token.',
      });
      cliente.disconnect(true);
    }
  }

  /** Envio pelo WebSocket, com confirmação (ack) como a resposta do POST de mensagens. */
  @SubscribeMessage('mensagem:enviar')
  async enviar(
    @ConnectedSocket() cliente: SocketAutenticado,
    @MessageBody() corpo: { conversaId?: unknown; conteudo?: unknown },
  ): Promise<Resposta> {
    const usuario = dadosDa(cliente).usuario;
    if (!usuario) {
      return {
        ok: false,
        codigo: 'NAO_AUTENTICADO',
        detalhe: 'Conecte de novo.',
      };
    }
    try {
      if (typeof corpo?.conversaId !== 'string' || !isUUID(corpo.conversaId)) {
        return {
          ok: false,
          codigo: 'DADOS_INVALIDOS',
          detalhe: 'Informe a conversa.',
        };
      }
      const mensagem = await this.conversas.enviar(
        usuario,
        corpo.conversaId,
        corpo.conteudo,
      );
      return { ok: true, mensagem };
    } catch (erro) {
      if (erro instanceof ErroNegocio) {
        return {
          ok: false,
          codigo: erro.codigo,
          detalhe: erro.detalhe ?? erro.titulo,
        };
      }
      this.log.error(`Falha ao enviar mensagem: ${String(erro)}`);
      return {
        ok: false,
        codigo: 'ERRO_INTERNO',
        detalhe: 'Não deu para enviar agora. Tente de novo.',
      };
    }
  }
}
