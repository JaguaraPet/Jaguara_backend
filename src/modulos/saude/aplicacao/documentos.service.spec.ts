import type { Armazenamento } from '../../../compartilhado/arquivos/armazenamento';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import {
  chaveDoDocumento,
  nomeSeguro,
  problemaNoArquivo,
} from '../dominio/documento';
import { DocumentosService } from './documentos.service';
import type { PoliticaSaude } from './politica-saude';

describe('DocumentosService (UC-34, RN15)', () => {
  const ana = { sub: 'ana' } as UsuarioAutenticado;
  const documento = {
    id: 'd1',
    petId: 'p1',
    titulo: 'Laudo',
    tipo: 'LAUDO',
    arquivoUrl: 'pets/p1/documentos/d1/laudo.pdf',
    dataEmissao: new Date('2026-11-01'),
    dataValidade: null,
    dataUpload: new Date('2026-11-23T12:00:00Z'),
  };
  const montar = (emExame = 0) => {
    const prisma = {
      documentoPet: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([documento]),
        findUnique: jest.fn().mockResolvedValue(documento),
        delete: jest.fn(),
      },
      exame: { count: jest.fn().mockResolvedValue(emExame) },
    };
    const politica = { garantir: jest.fn().mockResolvedValue(undefined) };
    const armazenamento = {
      urlEnvio: jest.fn().mockReturnValue('http://s3/envio'),
      urlDownload: jest.fn().mockReturnValue('http://s3/download'),
    };
    return {
      prisma,
      politica,
      armazenamento,
      servico: new DocumentosService(
        prisma as unknown as PrismaService,
        politica as unknown as PoliticaSaude,
        armazenamento as unknown as Armazenamento,
      ),
    };
  };
  const codigo = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: ErroNegocio) => e.codigo,
    );

  it('deve validar o arquivo e montar uma chave segura', () => {
    expect(problemaNoArquivo('laudo.PDF', 1000)).toBeNull();
    expect(problemaNoArquivo('script.exe', 1000)).toMatch(/PDF ou imagem/);
    expect(problemaNoArquivo('foto.jpg', 11 * 1024 * 1024)).toMatch(/10 MB/);
    expect(problemaNoArquivo('foto.jpg', 0)).toMatch(/vazio/);
    expect(nomeSeguro('../../Exame de sangue (março).pdf')).toBe(
      'Exame_de_sangue_marco_.pdf',
    );
    expect(chaveDoDocumento('p1', 'd1', 'raio x.png')).toBe(
      'pets/p1/documentos/d1/raio_x.png',
    );
  });

  it('CT-34-01: deve registrar o documento e devolver a URL de envio', async () => {
    const { prisma, politica, armazenamento, servico } = montar();
    const r = await servico.iniciarEnvio(ana, 'p1', {
      titulo: ' Laudo de sangue ',
      tipo: 'LAUDO',
      nomeArquivo: 'laudo.pdf',
      tamanhoBytes: 2048,
      dataEmissao: '2026-11-01',
    });
    expect(r.urlEnvio).toBe('http://s3/envio');
    expect(politica.garantir).toHaveBeenCalledWith(
      ana,
      'p1',
      'DOCUMENTOS',
      'editar',
    );
    const chave = (armazenamento.urlEnvio.mock.calls[0] as string[])[0];
    expect(chave).toBe(`pets/p1/documentos/${r.documentoId}/laudo.pdf`);
    expect(prisma.documentoPet.create.mock.calls[0]).toMatchObject([
      { data: { titulo: 'Laudo de sangue', arquivoUrl: chave } },
    ]);
    const lista = await servico.listar(ana, 'p1');
    expect(lista[0]).toMatchObject({
      nomeArquivo: 'laudo.pdf',
      dataEmissao: '2026-11-01',
    });
  });

  it('CT-34-02: deve checar o escopo no download e recusar dados ruins', async () => {
    const { politica, servico } = montar(1);
    await expect(servico.download(ana, 'd1')).resolves.toMatchObject({
      url: 'http://s3/download',
    });
    expect(politica.garantir).toHaveBeenCalledWith(
      ana,
      'p1',
      'DOCUMENTOS',
      'ler',
    );
    expect(await codigo(servico.excluir(ana, 'd1'))).toBe('DOCUMENTO_EM_USO');
    expect(
      await codigo(
        servico.iniciarEnvio(ana, 'p1', {
          titulo: 'X',
          tipo: 'OUTRO',
          nomeArquivo: 'a.pdf',
          tamanhoBytes: 10,
          dataEmissao: '2026-11-10',
          dataValidade: '2026-11-01',
        }),
      ),
    ).toBe('DADOS_INVALIDOS');
    politica.garantir.mockRejectedValueOnce(
      new ErroNegocio(403, 'SEM_PERMISSAO', 'Acesso negado'),
    );
    expect(await codigo(servico.download(ana, 'd1'))).toBe('SEM_PERMISSAO');
  });

  it('deve excluir documento que não é laudo', async () => {
    const { prisma, servico } = montar(0);
    await servico.excluir(ana, 'd1');
    expect(prisma.documentoPet.delete).toHaveBeenCalledWith({
      where: { id: 'd1' },
    });
  });
});
