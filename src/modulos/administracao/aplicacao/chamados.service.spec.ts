import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import type { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import type { FilaEmailService } from '../../notificacao/aplicacao/fila-email.service';
import {
  aceitaComplemento,
  aceitaIntervencao,
  comComplemento,
  gerarProtocolo,
} from '../dominio/chamado';
import { ChamadosService } from './chamados.service';

describe('ChamadosService (UC-26, RN32)', () => {
  const admin = { sub: 'adm' } as UsuarioAutenticado;
  const ana = { sub: 'u1' } as UsuarioAutenticado;
  const base = {
    id: 'c1',
    protocolo: 'SUP-20261126-AB12C',
    titulo: 'Não consigo anexar a vacina',
    descricao: 'O app fecha ao escolher a foto.',
    status: 'ABERTO',
    dataAbertura: new Date('2026-11-26T12:00:00Z'),
    dataFechamento: null,
    solicitanteId: 'u1',
    solicitante: {
      id: 'u1',
      email: 'ana@exemplo.com',
      tutor: { nome: 'Ana' },
      empresaEnterprise: null,
      funcionarioEnterprise: null,
      administrador: null,
    },
    atendente: null,
    intervencaoSuporte: [],
  };
  const montar = (status = 'ABERTO', falhaAuditoria = false) => {
    const tx = {
      intervencaoSuporte: { create: jest.fn() },
      chamadoSuporte: { update: jest.fn() },
      logAuditoria: {
        create: falhaAuditoria
          ? jest.fn().mockRejectedValue(new Error('auditoria fora'))
          : jest.fn(),
      },
    };
    const atual = { ...base, status };
    const prisma = {
      chamadoSuporte: {
        create: jest.fn((a: { data: object }) =>
          Promise.resolve({ ...base, ...a.data }),
        ),
        findMany: jest.fn().mockResolvedValue([atual]),
        findUnique: jest.fn().mockResolvedValue(atual),
        update: jest.fn((a: { data: object }) =>
          Promise.resolve({ ...atual, ...a.data }),
        ),
      },
      $transaction: jest.fn((f: (t: typeof tx) => Promise<void>) => f(tx)),
    };
    const fila = { enviar: jest.fn().mockResolvedValue(undefined) };
    return {
      tx,
      prisma,
      fila,
      servico: new ChamadosService(
        prisma as unknown as PrismaService,
        fila as unknown as FilaEmailService,
      ),
    };
  };
  const codigo = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: ErroNegocio) => e.codigo,
    );

  it('deve gerar o protocolo com a data e cinco caracteres', () => {
    expect(gerarProtocolo(new Date('2026-11-26T12:00:00Z'), () => 0)).toBe(
      'SUP-20261126-00000',
    );
    expect(gerarProtocolo(new Date('2026-11-26T12:00:00Z'))).toMatch(
      /^SUP-20261126-[0-9A-Z]{5}$/,
    );
  });

  it('deve aplicar as regras de situação do chamado', () => {
    expect(aceitaIntervencao('RESOLVIDO')).toBe(true);
    expect(aceitaIntervencao('FECHADO')).toBe(false);
    expect(aceitaComplemento('AGUARDANDO_INFORMACAO')).toBe(true);
    expect(aceitaComplemento('EM_ANALISE')).toBe(false);
    expect(
      comComplemento('Texto', ' Mais dados ', new Date('2026-11-26T15:00:00Z')),
    ).toContain('[Complemento em ');
  });

  it('deve abrir o chamado como ABERTO para quem pediu', async () => {
    const { servico, prisma } = montar();
    const criado = await servico.abrir(ana, {
      titulo: ' Erro na vacina ',
      descricao: ' O app fecha. ',
    });
    expect(criado.status).toBe('ABERTO');
    expect(prisma.chamadoSuporte.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        titulo: 'Erro na vacina',
        solicitanteId: 'u1',
        status: 'ABERTO',
      }) as unknown,
    });
  });

  it('CT-26-01: deve registrar a intervenção no chamado e na auditoria', async () => {
    const { servico, tx, fila } = montar();
    await servico.intervir(admin, 'c1', {
      acaoExecutada: 'Reprocessei o envio',
      descricao: 'Arquivo liberado.',
      status: 'RESOLVIDO',
    });
    expect(tx.intervencaoSuporte.create).toHaveBeenCalled();
    expect(tx.chamadoSuporte.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: expect.objectContaining({
        status: 'RESOLVIDO',
        atendenteId: 'adm',
        dataFechamento: expect.any(Date) as unknown,
      }) as unknown,
    });
    expect(tx.logAuditoria.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acao: 'INTERVENCAO_SUPORTE',
        entidadeId: 'c1',
        autorId: 'adm',
      }) as unknown,
    });
    expect(fila.enviar).toHaveBeenCalledWith(
      'NOTIFICACAO',
      'ana@exemplo.com',
      expect.anything(),
    );
  });

  it('CT-26-02: deve pedir informação e avisar o solicitante', async () => {
    const { servico, tx, fila } = montar('EM_ANALISE');
    await servico.pedirInformacao(admin, 'c1', 'Qual o modelo do celular?');
    expect(tx.chamadoSuporte.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: expect.objectContaining({
        status: 'AGUARDANDO_INFORMACAO',
        dataFechamento: null,
      }) as unknown,
    });
    expect(fila.enviar).toHaveBeenCalledWith(
      'NOTIFICACAO',
      'ana@exemplo.com',
      expect.objectContaining({
        mensagem: expect.stringContaining(
          'Qual o modelo do celular?',
        ) as unknown,
      }),
    );
  });

  it('deve recusar intervenção em chamado fechado', async () => {
    const { servico } = montar('FECHADO');
    expect(
      await codigo(servico.pedirInformacao(admin, 'c1', 'Mais dados?')),
    ).toBe('CHAMADO_FECHADO');
  });

  it('deve manter o chamado quando a auditoria falha', async () => {
    const { servico, fila } = montar('ABERTO', true);
    expect(
      await codigo(
        servico.intervir(admin, 'c1', {
          acaoExecutada: 'Ajuste',
          descricao: 'Feito agora.',
          status: 'RESOLVIDO',
        }),
      ),
    ).toBe('RN32_AUDITORIA_INDISPONIVEL');
    expect(fila.enviar).not.toHaveBeenCalled();
  });

  it('deve aceitar o complemento só quando o suporte pediu', async () => {
    const aguardando = montar('AGUARDANDO_INFORMACAO');
    const voltou = await aguardando.servico.complementar(
      ana,
      'c1',
      'Uso um Moto G.',
    );
    expect(voltou.status).toBe('EM_ANALISE');
    expect(voltou.descricao).toContain('Uso um Moto G.');
    expect(
      await codigo(
        montar('EM_ANALISE').servico.complementar(ana, 'c1', 'Mais.'),
      ),
    ).toBe('CHAMADO_SEM_PEDIDO');
    expect(
      await codigo(
        montar('AGUARDANDO_INFORMACAO').servico.complementar(
          admin,
          'c1',
          'Mais.',
        ),
      ),
    ).toBe('NAO_ENCONTRADO');
  });

  it('deve listar e detalhar com o nome do solicitante', async () => {
    const { servico } = montar();
    const [primeiro] = await servico.listar('ABERTO');
    expect(primeiro?.solicitante).toEqual({
      id: 'u1',
      nome: 'Ana',
      email: 'ana@exemplo.com',
      tipo: 'TUTOR',
    });
    expect((await servico.detalhar('c1')).intervencoes).toEqual([]);
    expect(await servico.meus(ana)).toHaveLength(1);
  });
});
