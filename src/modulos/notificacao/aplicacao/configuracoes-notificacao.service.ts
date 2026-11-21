import { Injectable } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import {
  ANTECEDENCIA_MAXIMA,
  configuracaoEfetiva,
  TIPOS_EVENTO,
} from '../dominio/programacao';
import type { Canal, Configuracao, TipoEvento } from '../dominio/programacao';

export interface Notificacao {
  id: string;
  titulo: string;
  mensagem: string;
  canal: Canal;
  dataProgramada: string;
  dataEnvio?: string;
  status: 'AGENDADA' | 'ENVIADA' | 'FALHOU' | 'CANCELADA';
}

/** Preferências de notificação (RN37) e a caixa de notificações do usuário (UC-31). */
@Injectable()
export class ConfiguracoesNotificacaoService {
  constructor(private readonly prisma: PrismaService) {}

  /** Uma configuração por tipo de compromisso, com o padrão onde o usuário não mexeu. */
  async listar(usuario: UsuarioAutenticado): Promise<Configuracao[]> {
    const salvas = await this.prisma.configuracaoNotificacao.findMany({
      where: { usuarioId: usuario.sub },
    });
    const porTipo = new Map(salvas.map((c) => [c.tipoEvento, c]));
    return TIPOS_EVENTO.map((tipo) => {
      const c = configuracaoEfetiva(tipo, porTipo.get(tipo));
      return {
        tipoEvento: c.tipoEvento,
        canal: c.canal,
        antecedenciaMinutos: c.antecedenciaMinutos,
        ativa: c.ativa,
      };
    });
  }

  /** CT-31-01: a antecedência vale para os lembretes agendados daqui em diante. */
  async salvar(
    usuario: UsuarioAutenticado,
    tipoEvento: TipoEvento,
    dados: { canal: Canal; antecedenciaMinutos: number; ativa: boolean },
  ): Promise<Configuracao> {
    if (dados.canal === 'SMS') {
      throw Erros.dadosInvalidos(
        'canal',
        'Por enquanto, escolha push ou e-mail.',
      );
    }
    if (
      dados.antecedenciaMinutos < 0 ||
      dados.antecedenciaMinutos > ANTECEDENCIA_MAXIMA
    ) {
      throw Erros.dadosInvalidos(
        'antecedenciaMinutos',
        'A antecedência vai de 0 a 7 dias.',
      );
    }
    const atual = await this.prisma.configuracaoNotificacao.findFirst({
      where: { usuarioId: usuario.sub, tipoEvento },
    });
    const salva = atual
      ? await this.prisma.configuracaoNotificacao.update({
          where: { id: atual.id },
          data: dados,
        })
      : await this.prisma.configuracaoNotificacao.create({
          data: { ...dados, tipoEvento, usuarioId: usuario.sub },
        });
    return {
      tipoEvento: salva.tipoEvento,
      canal: salva.canal,
      antecedenciaMinutos: salva.antecedenciaMinutos,
      ativa: salva.ativa,
    };
  }

  /** Notificações já enviadas e as próximas, mais recentes primeiro. */
  async notificacoes(usuario: UsuarioAutenticado): Promise<Notificacao[]> {
    const lista = await this.prisma.notificacao.findMany({
      where: {
        destinatarioId: usuario.sub,
        status: { in: ['AGENDADA', 'ENVIADA'] },
      },
      orderBy: { dataProgramada: 'desc' },
      take: 50,
    });
    return lista.map((n) => ({
      id: n.id,
      titulo: n.titulo,
      mensagem: n.mensagem,
      canal: n.canal,
      dataProgramada: n.dataProgramada.toISOString(),
      dataEnvio: n.dataEnvio?.toISOString(),
      status: n.status,
    }));
  }
}
