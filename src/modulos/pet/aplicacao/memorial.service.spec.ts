import type { Armazenamento } from '../../../compartilhado/arquivos/armazenamento';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { memorialHabilitado, problemaNoItem } from '../dominio/memorial';
import { MemorialService } from './memorial.service';
import type { PoliticaAcessoPet } from './politica-acesso-pet';

describe('MemorialService (UC-15, RN19)', () => {
  const ana = { sub: 'ana' } as UsuarioAutenticado;
  const montar = (status = 'FALECIDO', nivel = 'RESPONSAVEL_PRINCIPAL') => {
    const prisma = {
      pet: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'p1',
          nome: 'Thor',
          status,
          memorial: {
            mensagem: 'Saudade',
            publico: false,
            itemMemorial: [
              {
                id: 'i1',
                tipo: 'FOTO',
                conteudo: null,
                arquivoUrl: 'pets/p1/memorial/i1/a.jpg',
                dataRegistro: new Date(),
              },
            ],
          },
        }),
        update: jest.fn(),
      },
      registroClinico: {
        findMany: jest.fn().mockResolvedValue([{ id: 'r1' }]),
      },
      tratamentoMedicamentoso: {
        findMany: jest.fn().mockResolvedValue([{ id: 't1' }]),
        updateMany: jest.fn(),
      },
      eventoCalendario: { findMany: jest.fn().mockResolvedValue([]) },
      planoAlimentar: { findMany: jest.fn().mockResolvedValue([]) },
      agendamento: { findMany: jest.fn().mockResolvedValue([]) },
      notificacao: { updateMany: jest.fn() },
      memorial: { upsert: jest.fn().mockResolvedValue({ id: 'm1' }) },
      itemMemorial: {
        create: jest.fn(),
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'i1', memorial: { petId: 'p1' } }),
        delete: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const politica = { nivel: jest.fn().mockResolvedValue(nivel) };
    const armazenamento = {
      urlEnvio: jest.fn().mockReturnValue('http://s3/envio'),
      urlLeitura: jest.fn().mockReturnValue('http://s3/foto'),
    };
    return {
      prisma,
      servico: new MemorialService(
        prisma as unknown as PrismaService,
        politica as unknown as PoliticaAcessoPet,
        armazenamento as unknown as Armazenamento,
      ),
    };
  };
  const codigo = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: ErroNegocio) => e.codigo,
    );

  it('deve validar os itens e só habilitar para falecido', () => {
    expect(memorialHabilitado('FALECIDO')).toBe(true);
    expect(memorialHabilitado('ATIVO')).toBe(false);
    expect(problemaNoItem({ tipo: 'TEXTO', conteudo: 'Saudade' })).toBeNull();
    expect(problemaNoItem({ tipo: 'TEXTO', conteudo: ' ' })).toMatch(/texto/);
    expect(
      problemaNoItem({ tipo: 'FOTO', nomeArquivo: 'a.png', tamanhoBytes: 10 }),
    ).toBeNull();
    expect(
      problemaNoItem({ tipo: 'FOTO', nomeArquivo: 'a.gif', tamanhoBytes: 10 }),
    ).toMatch(/JPG/);
    expect(
      problemaNoItem({ tipo: 'FOTO', nomeArquivo: 'a.png', tamanhoBytes: 9e6 }),
    ).toMatch(/8 MB/);
  });

  it('deve registrar o falecimento cancelando os lembretes das origens do pet', async () => {
    const { prisma, servico } = montar('ATIVO');
    await servico.registrarFalecimento(ana, 'p1');
    expect(prisma.notificacao.updateMany).toHaveBeenCalledWith({
      where: { origemId: { in: ['r1', 't1'] }, status: 'AGENDADA' },
      data: { status: 'CANCELADA' },
    });
    expect(prisma.$transaction).toHaveBeenCalled();
    const adicional = montar('ATIVO', 'RESPONSAVEL');
    expect(
      await codigo(adicional.servico.registrarFalecimento(ana, 'p1')),
    ).toBe('SEM_PERMISSAO');
  });

  it('CT-15-01: deve salvar, mostrar a foto e adicionar lembranças', async () => {
    const { prisma, servico } = montar();
    const m = await servico.salvar(ana, 'p1', {
      mensagem: ' Saudade ',
      publico: false,
    });
    expect(m.itens[0].urlFoto).toBe('http://s3/foto');
    const foto = await servico.adicionarItem(ana, 'p1', {
      tipo: 'FOTO',
      nomeArquivo: 'a.jpg',
      tamanhoBytes: 10,
    });
    expect(foto.urlEnvio).toBe('http://s3/envio');
    await servico.adicionarItem(ana, 'p1', {
      tipo: 'HOMENAGEM',
      conteudo: 'Melhor amigo',
    });
    expect(prisma.itemMemorial.create).toHaveBeenCalledTimes(2);
    await servico.removerItem(ana, 'i1');
    expect(prisma.itemMemorial.delete).toHaveBeenCalledWith({
      where: { id: 'i1' },
    });
  });

  it('CT-15-02: deve bloquear o memorial de pet ativo e de quem não é responsável', async () => {
    const ativo = montar('ATIVO');
    expect(
      await codigo(
        ativo.servico.salvar(ana, 'p1', { mensagem: 'x', publico: false }),
      ),
    ).toBe('RN19_MEMORIAL_BLOQUEADO');
    const estranho = montar('FALECIDO', 'NENHUM');
    expect(await codigo(estranho.servico.consultar(ana, 'p1'))).toBe(
      'NAO_ENCONTRADO',
    );
  });
});
