import type { PublicadorWebhook } from '../../../compartilhado/webhooks/publicador-webhook';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import { CanalTempoReal } from '../../comunicacao/aplicacao/canal-tempo-real';
import type { FilaEmailService } from '../../notificacao/aplicacao/fila-email.service';
import type { PoliticaAcessoPet } from '../../pet/aplicacao/politica-acesso-pet';
import { GatewayIndisponivel } from '../infra/gateway-mercado-pago';
import type { AssinaturasService } from './assinaturas.service';
import { EVENTO_PAGAMENTO, PagamentosService } from './pagamentos.service';

describe('PagamentosService (UC-44, RN39)', () => {
  const tutor: UsuarioAutenticado = {
    sub: 't1',
    sid: 's1',
    tipo: 'TUTOR',
    perfil: 'Tutor',
    empresaId: null,
    permissoes: ['pagamento:realizar'],
  };
  const decimal = (v: number) => ({ toNumber: () => v });
  const base = {
    id: 'p1',
    codigoTransacao: '123',
    valor: decimal(60),
    dataHora: new Date('2026-11-20T12:00:00Z'),
    metodo: 'PIX' as const,
    status: 'PENDENTE' as const,
    dataConfirmacao: null,
    agendamentoId: 'a1',
    pagadorId: 't1',
    recebedorId: 'e1',
    agendamento: { servico: { nome: 'Banho' }, pet: { nome: 'Thor' } },
    pagador: { nome: 'Ana', usuario: { email: 'ana@exemplo.com' } },
  };

  const montar = () => {
    const prisma = {
      agendamento: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'a1',
          petId: 'pet1',
          status: 'AGENDADO',
          precoContratado: decimal(60),
          servico: { nome: 'Banho', empresaId: 'e1' },
          pet: { nome: 'Thor' },
        }),
      },
      pagamento: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue(base),
        update: jest.fn().mockResolvedValue(base),
        findUnique: jest.fn().mockResolvedValue(base),
        findUniqueOrThrow: jest.fn().mockResolvedValue(base),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      usuario: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ email: 'ana@exemplo.com' }),
      },
    };
    const gateway = {
      nome: 'teste',
      criarCobranca: jest.fn().mockResolvedValue({
        codigoTransacao: '123',
        status: 'PENDENTE',
        qrCode: 'qr',
      }),
      consultar: jest
        .fn()
        .mockResolvedValue({ codigoTransacao: '123', status: 'ACEITO' }),
    };
    const politica = {
      nivel: jest.fn().mockResolvedValue('RESPONSAVEL_PRINCIPAL'),
    };
    const fila = { enviar: jest.fn().mockResolvedValue(undefined) };
    const assinaturas = {
      precoMensal: 14.9,
      pendenteDoTutor: jest.fn().mockResolvedValue({ id: 'as1' }),
      ativar: jest.fn().mockResolvedValue(undefined),
    };
    const canal = new CanalTempoReal();
    const emitir = jest.spyOn(canal, 'emitir');
    const servico = new PagamentosService(
      prisma as unknown as PrismaService,
      politica as unknown as PoliticaAcessoPet,
      fila as unknown as FilaEmailService,
      canal,
      gateway,
      assinaturas as unknown as AssinaturasService,
      { publicar: jest.fn() } as unknown as PublicadorWebhook,
    );
    return { prisma, gateway, politica, fila, emitir, servico, assinaturas };
  };

  const codigo = async (promessa: Promise<unknown>) => {
    try {
      await promessa;
    } catch (erro) {
      return (erro as ErroNegocio).codigo;
    }
    return 'SEM_ERRO';
  };

  it('CT-44-01: deve criar o PIX pendente com o preço contratado e devolver o QR code', async () => {
    const { prisma, gateway, servico } = montar();
    const pagamento = await servico.iniciar(tutor, {
      agendamentoId: 'a1',
      metodo: 'PIX',
    });
    expect(pagamento).toMatchObject({ status: 'PENDENTE', qrCode: 'qr' });
    const criacao = prisma.pagamento.upsert.mock.calls[0] as [
      { create: { status: string; valor: unknown; recebedorId: string } },
    ];
    expect(criacao[0].create).toMatchObject({
      status: 'PENDENTE',
      recebedorId: 'e1',
    });
    expect(gateway.criarCobranca).toHaveBeenCalledWith(
      expect.objectContaining({ valor: 60, metodo: 'PIX' }),
    );
    expect(gateway.consultar).not.toHaveBeenCalled();
  });

  it('deve validar o pedido antes de falar com o gateway', async () => {
    const { prisma, politica, servico } = montar();
    expect(await codigo(servico.iniciar(tutor, { metodo: 'PIX' }))).toBe(
      'DADOS_INVALIDOS',
    );
    expect(
      await codigo(
        servico.iniciar(tutor, { agendamentoId: 'a1', metodo: 'BOLETO' }),
      ),
    ).toBe('DADOS_INVALIDOS');
    expect(
      await codigo(
        servico.iniciar(tutor, {
          agendamentoId: 'a1',
          metodo: 'CARTAO_CREDITO',
        }),
      ),
    ).toBe('DADOS_INVALIDOS');
    prisma.pagamento.count.mockResolvedValueOnce(1);
    expect(
      await codigo(
        servico.iniciar(tutor, { agendamentoId: 'a1', metodo: 'PIX' }),
      ),
    ).toBe('PAGAMENTO_JA_REALIZADO');
    politica.nivel.mockResolvedValueOnce('EMPRESA');
    expect(
      await codigo(
        servico.iniciar(tutor, { agendamentoId: 'a1', metodo: 'PIX' }),
      ),
    ).toBe('SEM_PERMISSAO');
    prisma.agendamento.findUnique.mockResolvedValueOnce(null);
    expect(
      await codigo(
        servico.iniciar(tutor, { agendamentoId: 'a1', metodo: 'PIX' }),
      ),
    ).toBe('NAO_ENCONTRADO');
  });

  it('deve manter o pagamento pendente quando o gateway não responde', async () => {
    const { gateway, prisma, servico } = montar();
    gateway.criarCobranca.mockRejectedValueOnce(new GatewayIndisponivel());
    expect(
      await codigo(
        servico.iniciar(tutor, { agendamentoId: 'a1', metodo: 'PIX' }),
      ),
    ).toBe('GATEWAY_INDISPONIVEL');
    expect(prisma.pagamento.update).not.toHaveBeenCalled();
  });

  it('deve confirmar uma vez só, avisar tutor e empresa e mandar o e-mail', async () => {
    const { prisma, fila, emitir, servico } = montar();
    await expect(servico.sincronizar('123')).resolves.toBe('ACEITO');
    expect(prisma.pagamento.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: 'PENDENTE' },
      data: expect.objectContaining({ status: 'ACEITO' }) as unknown,
    });
    expect(emitir).toHaveBeenCalledWith(
      ['usuario:t1', 'empresa:e1'],
      EVENTO_PAGAMENTO,
      expect.objectContaining({ status: 'ACEITO', valor: 60 }),
    );
    expect(fila.enviar).toHaveBeenCalledWith(
      'PAGAMENTO_CONFIRMADO',
      'ana@exemplo.com',
      expect.objectContaining({ pet: 'Thor' }),
    );

    // Evento repetido: outro processo já mudou o status.
    prisma.pagamento.updateMany.mockResolvedValueOnce({ count: 0 });
    await servico.sincronizar('123');
    expect(fila.enviar).toHaveBeenCalledTimes(1);

    prisma.pagamento.findUnique.mockResolvedValueOnce({
      ...base,
      status: 'ACEITO',
    });
    await expect(servico.sincronizar('123')).resolves.toBe('ACEITO');
    prisma.pagamento.findUnique.mockResolvedValueOnce(null);
    await expect(servico.sincronizar('999')).resolves.toBeNull();
  });

  it('CT-44-02: deve recusar o cartão com o motivo e consultar de novo o gateway', async () => {
    const { prisma, gateway, emitir, servico } = montar();
    gateway.criarCobranca.mockResolvedValueOnce({
      codigoTransacao: '123',
      status: 'RECUSADO',
      detalhe: 'cc_rejected_insufficient_amount',
    });
    gateway.consultar.mockResolvedValueOnce({
      codigoTransacao: '123',
      status: 'RECUSADO',
      detalhe: 'cc_rejected_insufficient_amount',
    });
    prisma.pagamento.findUniqueOrThrow.mockResolvedValueOnce({
      ...base,
      metodo: 'CARTAO_CREDITO',
      status: 'RECUSADO',
    });
    const pagamento = await servico.iniciar(tutor, {
      agendamentoId: 'a1',
      metodo: 'CARTAO_CREDITO',
      tokenCartao: 'tok',
      bandeiraCartao: 'visa',
    });
    expect(gateway.consultar).toHaveBeenCalledWith('123');
    expect(pagamento).toMatchObject({
      status: 'RECUSADO',
      motivoRecusa: 'Saldo ou limite insuficiente.',
    });
    expect(emitir).toHaveBeenCalledWith(
      ['usuario:t1'],
      EVENTO_PAGAMENTO,
      expect.objectContaining({ status: 'RECUSADO' }),
    );
  });

  it('deve reconciliar os pendentes e seguir quando um deles falha', async () => {
    const { prisma, gateway, servico } = montar();
    prisma.pagamento.findMany.mockResolvedValueOnce([
      { codigoTransacao: '123' },
      { codigoTransacao: '456' },
    ]);
    gateway.consultar
      .mockResolvedValueOnce({ codigoTransacao: '123', status: 'ACEITO' })
      .mockRejectedValueOnce(new GatewayIndisponivel());
    await expect(servico.reconciliar()).resolves.toBe(1);
  });

  it('deve cobrar a assinatura PANTERA pelo preço mensal e ativá-la na confirmação', async () => {
    const { prisma, gateway, assinaturas, servico } = montar();
    prisma.pagamento.upsert.mockImplementationOnce(
      (args: { create: { valor: number } }) =>
        Promise.resolve({ ...base, valor: decimal(args.create.valor) }),
    );
    await servico.iniciar(tutor, { assinaturaId: 'as1', metodo: 'PIX' });
    expect(assinaturas.pendenteDoTutor).toHaveBeenCalledWith('t1', 'as1');
    expect(gateway.criarCobranca).toHaveBeenCalledWith(
      expect.objectContaining({
        valor: 14.9,
        descricao: 'Assinatura PANTERA - 1 mês',
      }),
    );
    const criacao = prisma.pagamento.upsert.mock.calls[0] as [
      { create: { recebedorId: string | null; assinaturaId?: string } },
    ];
    expect(criacao[0].create).toMatchObject({
      recebedorId: null,
      assinaturaId: 'as1',
    });

    prisma.pagamento.findUnique.mockResolvedValueOnce({
      ...base,
      agendamentoId: null,
      agendamento: null,
      assinaturaId: 'as1',
      recebedorId: null,
    });
    await servico.sincronizar('123');
    expect(assinaturas.ativar).toHaveBeenCalledWith('as1');
    expect(
      await codigo(
        servico.iniciar(tutor, {
          agendamentoId: 'a1',
          assinaturaId: 'as1',
          metodo: 'PIX',
        }),
      ),
    ).toBe('DADOS_INVALIDOS');
  });
});
