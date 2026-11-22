import { Injectable } from '@nestjs/common';
import { garantirMesmaEmpresa } from '../../../compartilhado/auth/escopo-empresa';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { idadeEmAnos } from '../../pet/dominio/pet';
import { motivosDoVinculo, secoesLiberadas } from '../dominio/perfil-empresa';
import type { MotivoVinculo, SecaoPerfil } from '../dominio/perfil-empresa';

export interface PetVinculado {
  id: string;
  nome: string;
  especie: string;
  raca: string;
  sexo: string;
  idade?: number;
  status: string;
  motivos: MotivoVinculo[];
  secoes: SecaoPerfil[];
}

const dia = (d: Date) => d.toISOString().slice(0, 10);

/** Pets vinculados à empresa (UC-20) e o perfil com as seções liberadas (UC-22). */
@Injectable()
export class PetsVinculadosService {
  constructor(private readonly prisma: PrismaService) {}

  /** CT-20-01: só pets com compartilhamento ativo, agendamento ou de clientes da empresa (RN24). */
  async listar(
    usuario: UsuarioAutenticado,
    empresaId: string,
  ): Promise<PetVinculado[]> {
    this.garantirAcesso(usuario, empresaId);
    const agora = new Date();
    const pets = await this.prisma.pet.findMany({
      where: {
        OR: [
          {
            compartilhamentoPet: {
              some: this.compartilhamentoAtivo(empresaId, agora),
            },
          },
          { agendamento: { some: { servico: { empresaId } } } },
          { clientePet: { some: { cliente: { empresaId, ativo: true } } } },
        ],
      },
      include: this.incluir(empresaId, agora),
      orderBy: { nome: 'asc' },
    });
    return pets.map((p) => this.resposta(p));
  }

  /** CT-22-01 e CT-22-02: o perfil com as seções que o tutor liberou (RN26). */
  async perfil(usuario: UsuarioAutenticado, empresaId: string, petId: string) {
    this.garantirAcesso(usuario, empresaId);
    const agora = new Date();
    const pet = await this.prisma.pet.findUnique({
      where: { id: petId },
      include: this.incluir(empresaId, agora),
    });
    const vinculado = pet && this.resposta(pet);
    if (!pet || !vinculado || vinculado.motivos.length === 0) {
      throw Erros.semPermissao(
        'O tutor não liberou este pet para a sua empresa.',
      );
    }
    const clinico = { petId, valido: true };
    const liberada = (s: SecaoPerfil) => vinculado.secoes.includes(s);
    const [vacinas, exames, medicamentos, alergias] = await Promise.all([
      liberada('vacinas')
        ? this.prisma.vacinacao.findMany({
            where: { registroClinico: clinico },
            orderBy: { dataAplicacao: 'asc' },
          })
        : null,
      liberada('exames')
        ? this.prisma.exame.findMany({
            where: { registroClinico: clinico },
            orderBy: { dataRealizacao: 'desc' },
          })
        : null,
      liberada('medicamentos')
        ? this.prisma.tratamentoMedicamentoso.findMany({
            where: { registroClinico: clinico },
            orderBy: { dataInicio: 'desc' },
          })
        : null,
      liberada('alergias')
        ? this.prisma.alergiaRestricao.findMany({ where: { petId } })
        : null,
    ]);
    return {
      ...vinculado,
      vacinas: vacinas?.map((v) => ({
        nomeVacina: v.nomeVacina,
        dataAplicacao: dia(v.dataAplicacao),
        dataProximaDose: v.dataProximaDose ? dia(v.dataProximaDose) : undefined,
      })),
      exames: exames?.map((e) => ({
        tipoExame: e.tipoExame,
        dataRealizacao: dia(e.dataRealizacao),
        resultado: e.resultado ?? undefined,
      })),
      medicamentos: medicamentos?.map((t) => ({
        medicamento: t.medicamento,
        dosagem: t.dosagem,
        status: t.status,
        dataInicio: dia(t.dataInicio),
      })),
      alergias: alergias?.map((a) => ({
        tipo: a.tipo,
        descricao: a.descricao,
        gravidade: a.gravidade,
      })),
    };
  }

  /** Empresa e funcionários com cliente:ler ou atendimento:ler, só da própria empresa. */
  private garantirAcesso(usuario: UsuarioAutenticado, empresaId: string) {
    garantirMesmaEmpresa(usuario, empresaId);
    if (
      !usuario.permissoes.includes('cliente:ler') &&
      !usuario.permissoes.includes('atendimento:ler')
    ) {
      throw Erros.semPermissao();
    }
  }

  private compartilhamentoAtivo(empresaId: string, agora: Date) {
    return {
      empresaId,
      status: 'ATIVO' as const,
      OR: [{ dataExpiracao: null }, { dataExpiracao: { gt: agora } }],
    };
  }

  private incluir(empresaId: string, agora: Date) {
    return {
      raca: { include: { especie: true } },
      compartilhamentoPet: {
        where: this.compartilhamentoAtivo(empresaId, agora),
        select: { escopos: true },
      },
      agendamento: {
        where: { servico: { empresaId } },
        select: { id: true },
        take: 1,
      },
      clientePet: {
        where: { cliente: { empresaId, ativo: true } },
        select: { cliente: { select: { tutorId: true } } },
      },
    };
  }

  private resposta(p: {
    id: string;
    nome: string;
    sexo: string;
    status: string;
    dataNascimento: Date | null;
    raca: { nome: string; especie: { nome: string } };
    compartilhamentoPet: { escopos: string[] }[];
    agendamento: { id: string }[];
    clientePet: { cliente: { tutorId: string | null } }[];
  }): PetVinculado {
    const escopos = p.compartilhamentoPet.flatMap((c) => c.escopos);
    return {
      id: p.id,
      nome: p.nome,
      especie: p.raca.especie.nome,
      raca: p.raca.nome,
      sexo: p.sexo,
      idade: idadeEmAnos(p.dataNascimento, new Date()),
      status: p.status,
      motivos: motivosDoVinculo({
        compartilhado: p.compartilhamentoPet.length > 0,
        agendado: p.agendamento.length > 0,
        cliente: p.clientePet.length > 0,
      }),
      secoes: secoesLiberadas({
        escopos,
        clienteSemConta: p.clientePet.some((c) => c.cliente.tutorId === null),
      }),
    };
  }
}
