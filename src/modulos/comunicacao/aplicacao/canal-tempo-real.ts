import { Injectable } from '@nestjs/common';
import type { Namespace } from 'socket.io';

/**
 * Ponte entre os serviços e o gateway do Socket.IO (ADR-011): os serviços avisam as
 * salas sem depender do gateway, que registra o servidor quando sobe.
 */
@Injectable()
export class CanalTempoReal {
  private servidor?: Namespace;

  registrar(servidor: Namespace) {
    this.servidor = servidor;
  }

  emitir(salas: string[], evento: string, dados: unknown) {
    if (!this.servidor || salas.length === 0) return;
    this.servidor.to(salas).emit(evento, dados);
  }
}
