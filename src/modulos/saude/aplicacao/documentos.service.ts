import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  Armazenamento,
  VALIDADE_URL_SEGUNDOS,
} from '../../../compartilhado/arquivos/armazenamento';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { Erros } from '../../../compartilhado/erros/erro-negocio';
import { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import {
  chaveDoDocumento,
  nomeDaChave,
  problemaNoArquivo,
} from '../dominio/documento';
import type { TipoDocumento } from '../dominio/documento';
import { PoliticaSaude } from './politica-saude';

export interface Documento {
  id: string;
  titulo: string;
  tipo: TipoDocumento;
  nomeArquivo: string;
  dataEmissao?: string;
  dataValidade?: string;
  dataUpload: string;
}

export interface NovoDocumento {
  titulo: string;
  tipo: TipoDocumento;
  nomeArquivo: string;
  tamanhoBytes: number;
  dataEmissao?: string;
  dataValidade?: string;
}

const dia = (d: Date) => d.toISOString().slice(0, 10);
const expiraEm = (agora: Date) =>
  new Date(agora.getTime() + VALIDADE_URL_SEGUNDOS * 1000).toISOString();

/** Documentos do pet com envio e download por URL assinada (UC-34, RN15, ADR-005). */
@Injectable()
export class DocumentosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly politica: PoliticaSaude,
    private readonly armazenamento: Armazenamento,
  ) {}

  /** CT-34-01: registra o documento e devolve a URL de envio, válida por 5 minutos. */
  async iniciarEnvio(
    usuario: UsuarioAutenticado,
    petId: string,
    dados: NovoDocumento,
  ) {
    await this.politica.garantir(usuario, petId, 'DOCUMENTOS', 'editar');
    const problema = problemaNoArquivo(dados.nomeArquivo, dados.tamanhoBytes);
    if (problema) throw Erros.dadosInvalidos('nomeArquivo', problema);
    if (
      dados.dataEmissao &&
      dados.dataValidade &&
      dados.dataValidade < dados.dataEmissao
    ) {
      throw Erros.dadosInvalidos(
        'dataValidade',
        'A validade não pode ser anterior à emissão.',
      );
    }
    const id = randomUUID();
    const chave = chaveDoDocumento(petId, id, dados.nomeArquivo);
    const agora = new Date();
    await this.prisma.documentoPet.create({
      data: {
        id,
        petId,
        titulo: dados.titulo.trim(),
        tipo: dados.tipo,
        arquivoUrl: chave,
        dataEmissao: dados.dataEmissao ? new Date(dados.dataEmissao) : null,
        dataValidade: dados.dataValidade ? new Date(dados.dataValidade) : null,
        dataUpload: agora,
      },
    });
    return {
      documentoId: id,
      urlEnvio: this.armazenamento.urlEnvio(chave, agora),
      expiraEm: expiraEm(agora),
    };
  }

  async listar(
    usuario: UsuarioAutenticado,
    petId: string,
  ): Promise<Documento[]> {
    await this.politica.garantir(usuario, petId, 'DOCUMENTOS', 'ler');
    const documentos = await this.prisma.documentoPet.findMany({
      where: { petId },
      orderBy: { dataUpload: 'desc' },
    });
    return documentos.map((d) => ({
      id: d.id,
      titulo: d.titulo,
      tipo: d.tipo,
      nomeArquivo: nomeDaChave(d.arquivoUrl),
      dataEmissao: d.dataEmissao ? dia(d.dataEmissao) : undefined,
      dataValidade: d.dataValidade ? dia(d.dataValidade) : undefined,
      dataUpload: d.dataUpload.toISOString(),
    }));
  }

  /** CT-34-02: sem o escopo DOCUMENTOS, o destinatário não abre o arquivo. */
  async download(usuario: UsuarioAutenticado, documentoId: string) {
    const documento = await this.buscar(documentoId);
    await this.politica.garantir(usuario, documento.petId, 'DOCUMENTOS', 'ler');
    const agora = new Date();
    return {
      url: this.armazenamento.urlDownload(
        documento.arquivoUrl,
        nomeDaChave(documento.arquivoUrl),
        agora,
      ),
      expiraEm: expiraEm(agora),
    };
  }

  /** Exclui o registro; laudo usado em exame não sai (o exame guarda o arquivo). */
  async excluir(usuario: UsuarioAutenticado, documentoId: string) {
    const documento = await this.buscar(documentoId);
    await this.politica.garantir(
      usuario,
      documento.petId,
      'DOCUMENTOS',
      'editar',
    );
    const emExame = await this.prisma.exame.count({
      where: { arquivoResultadoUrl: documento.arquivoUrl },
    });
    if (emExame > 0) {
      throw Erros.conflito(
        'DOCUMENTO_EM_USO',
        'Este documento é o laudo de um exame e não pode ser excluído.',
      );
    }
    await this.prisma.documentoPet.delete({ where: { id: documentoId } });
  }

  private async buscar(documentoId: string) {
    const documento = await this.prisma.documentoPet.findUnique({
      where: { id: documentoId },
    });
    if (!documento) throw Erros.naoEncontrado('Documento não encontrado');
    return documento;
  }
}
