import { Injectable } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { PoliticaAcessoPet } from '../../pet/aplicacao/politica-acesso-pet';
import { podeAcessarSaude } from '../dominio/acesso-saude';
import type { EscopoSaude, ModoAcesso } from '../dominio/acesso-saude';

/**
 * Acesso aos dados de saúde do pet (RN15, RN26, RN30): o tutor responsável com saude:ler ou
 * saude:editar; a empresa só com o escopo compartilhado pelo tutor (e EDICAO_CLINICA para
 * registrar) ou para pet de cliente sem conta que ela mesma cadastrou.
 */
@Injectable()
export class PoliticaSaude {
  constructor(
    private readonly prisma: PrismaService,
    private readonly politicaPet: PoliticaAcessoPet,
  ) {}

  async garantir(
    usuario: UsuarioAutenticado,
    petId: string,
    escopo: EscopoSaude,
    modo: ModoAcesso,
  ): Promise<void> {
    const nivel = await this.politicaPet.nivel(usuario, petId);
    if (nivel === 'NENHUM') throw Erros.naoEncontrado('Pet não encontrado');

    let escopos: string[] = [];
    let clienteSemConta = false;
    if (nivel === 'EMPRESA' && usuario.empresaId) {
      const agora = new Date();
      const [compartilhamentos, semConta] = await Promise.all([
        this.prisma.compartilhamentoPet.findMany({
          where: {
            petId,
            empresaId: usuario.empresaId,
            status: 'ATIVO',
            OR: [{ dataExpiracao: null }, { dataExpiracao: { gt: agora } }],
          },
          select: { escopos: true },
        }),
        this.politicaPet.petDeClienteSemConta(usuario.empresaId, petId),
      ]);
      escopos = compartilhamentos.flatMap((c) => c.escopos);
      clienteSemConta = semConta;
    }

    if (
      !podeAcessarSaude({
        nivel,
        permissoes: usuario.permissoes,
        escopos,
        clienteSemConta,
        escopo,
        modo,
      })
    ) {
      throw Erros.semPermissao(
        nivel === 'EMPRESA'
          ? 'O tutor não compartilhou estes dados de saúde com a sua empresa.'
          : 'Seu perfil não pode fazer isso.',
      );
    }
  }
}
