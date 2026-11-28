import {
  CategoriaServico,
  DiaSemana,
  EscopoAcesso,
  Gravidade,
  MeioColeta,
  MetodoPagamento,
  Prisma,
  Sexo,
  StatusAgendamento,
  StatusAtendimento,
  StatusCompartilhamento,
  StatusConta,
  StatusConversa,
  StatusPagamento,
  StatusPet,
  StatusSolicitacao,
  TipoAlergiaRestricao,
  TipoConversa,
  TipoEmpresa,
  TipoRecurso,
  TipoResponsavel,
  TipoTermo,
} from '../../../generated/prisma/client';
import { Cifragem } from '../../../compartilhado/cripto/cifragem';
import { PERFIS_EMPRESA_PADRAO } from '../../acesso/dominio/catalogo-permissoes';
import { sincronizarEspecies } from '../../pet/aplicacao/catalogo-especies.service';
import {
  dataBrasilia,
  diaDaSemanaBrasilia,
  emBrasilia,
} from '../dominio/horario-sp';
import {
  cnpjAleatorio,
  cpfAleatorio,
  emailDemonstracao,
} from '../dominio/identificadores';

type Db = Prisma.TransactionClient;

export interface OpcoesClinica {
  agora: Date;
  /** Sufixo único dos e-mails desta clínica. */
  sufixo: string;
  cifragem: Cifragem;
  /** Hash da senha das contas que podem entrar; `null` deixa só a entrada pela demonstração. */
  senhaHash: string | null;
  /** E-mails fixos (seed local); sem eles, e-mails no domínio reservado de demonstração. */
  emails?: { empresa: string; tutor: string };
  nomeFantasia?: string;
  /** IP registrado no aceite dos termos das contas que entram. */
  ipOrigem?: string;
}

export interface ClinicaCriada {
  empresaId: string;
  tutorId: string;
}

const HORARIOS = [
  '08:30',
  '09:30',
  '10:30',
  '11:30',
  '14:00',
  '15:00',
  '16:00',
  '17:00',
];

/**
 * Plantão de domingo de manhã: quem abre a demonstração num domingo também encontra a clínica
 * atendendo, em vez de uma tela Hoje vazia.
 */
const PLANTAO_DOMINGO = ['09:30', '10:30', '11:30'];

/**
 * Monta uma clínica veterinária completa e realista para demonstração: equipe, serviços,
 * clientes com pets, uma semana de agenda para trás e para frente, atendimentos, vacinas com
 * próxima dose, cobranças pagas e em aberto, solicitações pendentes e uma conversa.
 * Todas as datas são relativas a `agora`, então a demonstração nunca abre vazia.
 */
export async function criarClinicaDemonstracao(
  db: Db,
  op: OpcoesClinica,
): Promise<ClinicaCriada> {
  const { agora, sufixo, cifragem, senhaHash } = op;
  await sincronizarEspecies(db);

  const perfilGlobal = async (nome: string) =>
    (
      await db.perfilAcesso.findFirstOrThrow({
        where: { nome, escopo: 'GLOBAL', empresaId: null },
      })
    ).id;
  const perfilEmpresa = await perfilGlobal('Empresa');
  const perfilTutor = await perfilGlobal('Tutor');

  const novoUsuario = (
    email: string,
    perfilId: string,
    telefone?: string,
    podeEntrar = false,
  ) =>
    db.usuario.create({
      data: {
        email,
        senhaHash: podeEntrar ? senhaHash : null,
        telefone,
        emailConfirmado: true,
        status: StatusConta.ATIVA,
        tentativasLoginFalhas: 0,
        dataCadastro: agora,
        perfilId,
      },
    });

  // Empresa e perfis
  const nomeFantasia = op.nomeFantasia ?? 'Clínica Vida Animal';
  const dono = await novoUsuario(
    op.emails?.empresa ?? emailDemonstracao('clinica', sufixo),
    perfilEmpresa,
    '(11) 3333-4400',
    true,
  );
  const empresaId = dono.id;
  await db.empresaEnterprise.create({
    data: {
      id: empresaId,
      cnpj: cnpjAleatorio(),
      razaoSocial: `${nomeFantasia} Serviços Veterinários Ltda.`,
      nomeFantasia,
      tipo: TipoEmpresa.CLINICA_VETERINARIA,
      enderecoCep: '05415-000',
      enderecoLogradouro: 'Rua dos Pinheiros',
      enderecoNumero: '820',
      enderecoBairro: 'Pinheiros',
      enderecoCidade: 'São Paulo',
      enderecoUf: 'SP',
    },
  });
  const permissoes = new Map(
    (await db.permissao.findMany({ select: { id: true, codigo: true } })).map(
      (p) => [p.codigo, p.id],
    ),
  );
  const perfis: Record<string, string> = {};
  for (const [nome, p] of Object.entries(PERFIS_EMPRESA_PADRAO)) {
    const criado = await db.perfilAcesso.create({
      data: {
        nome,
        descricao: p.descricao,
        escopo: 'EMPRESA',
        empresaId,
        perfilPermissao: {
          create: p.permissoes
            .filter((c) => permissoes.has(c))
            .map((c) => ({ permissaoId: permissoes.get(c)! })),
        },
      },
    });
    perfis[nome] = criado.id;
  }

  // Serviços
  const servicos = {
    consulta: {
      nome: 'Consulta clínica',
      categoria: CategoriaServico.CONSULTA,
      preco: '180.00',
      duracao: 40,
    },
    retorno: {
      nome: 'Retorno de consulta',
      categoria: CategoriaServico.CONSULTA,
      preco: '90.00',
      duracao: 20,
    },
    v10: {
      nome: 'Vacina V10',
      categoria: CategoriaServico.VACINACAO,
      preco: '120.00',
      duracao: 20,
    },
    raiva: {
      nome: 'Vacina antirrábica',
      categoria: CategoriaServico.VACINACAO,
      preco: '90.00',
      duracao: 15,
    },
    v5: {
      nome: 'Vacina V5 felina',
      categoria: CategoriaServico.VACINACAO,
      preco: '140.00',
      duracao: 20,
    },
    hemograma: {
      nome: 'Hemograma completo',
      categoria: CategoriaServico.EXAME,
      preco: '95.00',
      duracao: 20,
    },
    ultrassom: {
      nome: 'Ultrassom abdominal',
      categoria: CategoriaServico.EXAME,
      preco: '220.00',
      duracao: 40,
    },
  } as const;
  type ChaveServico = keyof typeof servicos;
  const idServico = {} as Record<
    ChaveServico,
    { id: string; preco: string; duracao: number; nome: string }
  >;
  for (const [chave, s] of Object.entries(servicos) as [
    ChaveServico,
    (typeof servicos)[ChaveServico],
  ][]) {
    const criado = await db.servico.create({
      data: {
        empresaId,
        nome: s.nome,
        descricao: `${s.nome} com hora marcada.`,
        categoria: s.categoria,
        preco: s.preco,
        duracaoMinutos: s.duracao,
        ativo: true,
      },
    });
    idServico[chave] = {
      id: criado.id,
      preco: s.preco,
      duracao: s.duracao,
      nome: s.nome,
    };
  }

  // Consultórios e equipe
  const semana = [
    DiaSemana.SEGUNDA,
    DiaSemana.TERCA,
    DiaSemana.QUARTA,
    DiaSemana.QUINTA,
    DiaSemana.SEXTA,
  ];
  const hora = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00Z`);
  const consultorios: string[] = [];
  for (const nome of ['Consultório 1', 'Consultório 2']) {
    const r = await db.recurso.create({
      data: { empresaId, nome, tipo: TipoRecurso.SALA, ativo: true },
    });
    consultorios.push(r.id);
    for (const diaSemana of semana) {
      await db.horarioAtuacao.create({
        data: {
          recursoId: r.id,
          diaSemana,
          horaInicio: hora('08:00'),
          horaFim: hora('18:00'),
        },
      });
    }
  }
  // O plantão de domingo usa o consultório 1.
  await db.horarioAtuacao.create({
    data: {
      recursoId: consultorios[0],
      diaSemana: DiaSemana.DOMINGO,
      horaInicio: hora('09:00'),
      horaFim: hora('13:00'),
    },
  });
  const equipe = [
    {
      chave: 'julia',
      nome: 'Júlia Andrade',
      cargo: 'Médica-veterinária',
      perfil: 'Profissional',
    },
    {
      chave: 'paulo',
      nome: 'Paulo Lima',
      cargo: 'Médico-veterinário',
      perfil: 'Profissional',
    },
    {
      chave: 'rafael',
      nome: 'Rafael Souza',
      cargo: 'Recepcionista',
      perfil: 'Atendente',
    },
  ] as const;
  const funcionario: Record<string, string> = {};
  for (const f of equipe) {
    const u = await novoUsuario(
      emailDemonstracao(f.chave, sufixo),
      perfis[f.perfil],
    );
    const cpf = cpfAleatorio();
    await db.funcionarioEnterprise.create({
      data: {
        id: u.id,
        nome: f.nome,
        cpfCifrado: cifragem.cifrar(cpf),
        cpfHash: cifragem.indiceCego(cpf),
        cargo: f.cargo,
        ativo: true,
        empresaId,
      },
    });
    funcionario[f.chave] = u.id;
    for (const diaSemana of [...semana, DiaSemana.SABADO, DiaSemana.DOMINGO]) {
      const sabado = diaSemana === DiaSemana.SABADO;
      const domingo = diaSemana === DiaSemana.DOMINGO;
      // No domingo, só os veterinários fazem o plantão.
      if (domingo && f.perfil !== 'Profissional') continue;
      await db.horarioAtuacao.create({
        data: {
          funcionarioId: u.id,
          diaSemana,
          horaInicio: hora(domingo ? '09:00' : '08:00'),
          horaFim: hora(domingo ? '13:00' : sabado ? '12:00' : '18:00'),
        },
      });
    }
  }
  const veterinarios = [funcionario.julia, funcionario.paulo];
  const nomeVet = {
    [funcionario.julia]: 'Dra. Júlia Andrade',
    [funcionario.paulo]: 'Dr. Paulo Lima',
  };

  // Tutores e pets
  const raca = async (especie: string, nome: string) =>
    (
      await db.raca.findFirstOrThrow({
        where: { nome, especie: { nome: especie } },
      })
    ).id;
  const anos = (n: number, meses = 0) =>
    dataBrasilia(agora, -Math.round(n * 365 + meses * 30));
  const tutores = [
    {
      chave: 'marina',
      nome: 'Marina Costa',
      tel: '(11) 98888-1001',
      principal: true,
      pets: [
        {
          nome: 'Bento',
          especie: 'Cachorro',
          raca: 'Golden Retriever',
          sexo: Sexo.MACHO,
          nasc: anos(4, 2),
          peso: '31.2',
          cor: 'Dourado',
          castrado: true,
        },
        {
          nome: 'Luna',
          especie: 'Gato',
          raca: 'Sem raça definida',
          sexo: Sexo.FEMEA,
          nasc: anos(2, 5),
          peso: '3.8',
          cor: 'Tigrada',
          castrado: true,
        },
      ],
    },
    {
      chave: 'ana',
      nome: 'Ana Ribeiro',
      tel: '(11) 98888-1002',
      pets: [
        {
          nome: 'Thor',
          especie: 'Cachorro',
          raca: 'Labrador',
          sexo: Sexo.MACHO,
          nasc: anos(5, 8),
          peso: '29.5',
          cor: 'Caramelo',
          castrado: true,
        },
      ],
    },
    {
      chave: 'bruno',
      nome: 'Bruno Carvalho',
      tel: '(11) 98888-1003',
      pets: [
        {
          nome: 'Mel',
          especie: 'Cachorro',
          raca: 'Shih Tzu',
          sexo: Sexo.FEMEA,
          nasc: anos(7, 1),
          peso: '6.3',
          cor: 'Branco e dourado',
          castrado: true,
        },
      ],
    },
    {
      chave: 'carla',
      nome: 'Carla Mendes',
      tel: '(11) 98888-1004',
      pets: [
        {
          nome: 'Nina',
          especie: 'Cachorro',
          raca: 'Poodle',
          sexo: Sexo.FEMEA,
          nasc: anos(10, 3),
          peso: '7.9',
          cor: 'Branca',
          castrado: true,
        },
      ],
    },
    {
      chave: 'diego',
      nome: 'Diego Ramos',
      tel: '(11) 98888-1005',
      pets: [
        {
          nome: 'Fred',
          especie: 'Cachorro',
          raca: 'Bulldog Francês',
          sexo: Sexo.MACHO,
          nasc: anos(3),
          peso: '12.4',
          cor: 'Tigrado',
          castrado: false,
        },
      ],
    },
    {
      chave: 'elisa',
      nome: 'Elisa Nunes',
      tel: '(11) 98888-1006',
      pets: [
        {
          nome: 'Simba',
          especie: 'Gato',
          raca: 'Persa',
          sexo: Sexo.MACHO,
          nasc: anos(6, 6),
          peso: '4.6',
          cor: 'Laranja',
          castrado: true,
        },
      ],
    },
    {
      chave: 'fabio',
      nome: 'Fábio Teixeira',
      tel: '(11) 98888-1007',
      pets: [
        {
          nome: 'Pipoca',
          especie: 'Cachorro',
          raca: 'Sem raça definida',
          sexo: Sexo.FEMEA,
          nasc: anos(1, 4),
          peso: '9.1',
          cor: 'Preta e branca',
          castrado: false,
        },
      ],
    },
  ];
  const pet: Record<string, string> = {};
  const donoDoPet: Record<string, string> = {};
  let tutorPrincipal = '';
  let codigoCliente = 1;
  for (const t of tutores) {
    const email =
      t.principal && op.emails
        ? op.emails.tutor
        : emailDemonstracao(t.chave, sufixo);
    const u = await novoUsuario(
      email,
      perfilTutor,
      t.tel,
      Boolean(t.principal),
    );
    const cpf = cpfAleatorio();
    await db.tutor.create({
      data: {
        id: u.id,
        nome: t.nome,
        cpfCifrado: cifragem.cifrar(cpf),
        cpfHash: cifragem.indiceCego(cpf),
        enderecoCidade: 'São Paulo',
        enderecoUf: 'SP',
      },
    });
    if (t.principal) tutorPrincipal = u.id;
    const cliente = await db.cliente.create({
      data: {
        empresaId,
        tutorId: u.id,
        codigo: `CLI-${String(codigoCliente++).padStart(4, '0')}`,
        nome: t.nome,
        email,
        telefone: t.tel,
        dataVinculo: dataBrasilia(agora, -200 + codigoCliente * 17),
        ativo: true,
      },
    });
    for (const p of t.pets) {
      const criado = await db.pet.create({
        data: {
          nome: p.nome,
          racaId: await raca(p.especie, p.raca),
          sexo: p.sexo,
          dataNascimento: p.nasc,
          pesoKg: p.peso,
          cor: p.cor,
          castrado: p.castrado,
          status: StatusPet.ATIVO,
        },
      });
      pet[p.nome] = criado.id;
      donoDoPet[p.nome] = u.id;
      await db.responsavelPet.create({
        data: {
          petId: criado.id,
          tutorId: u.id,
          tipo: TipoResponsavel.PRINCIPAL,
          dataVinculo: agora,
          ativo: true,
        },
      });
      await db.clientePet.create({
        data: { clienteId: cliente.id, petId: criado.id },
      });
      await db.compartilhamentoPet.create({
        data: {
          petId: criado.id,
          empresaId,
          token: `demo-${sufixo}-${p.nome.toLowerCase()}`,
          escopos: [
            EscopoAcesso.PERFIL_BASICO,
            EscopoAcesso.VACINAS,
            EscopoAcesso.EXAMES,
            EscopoAcesso.MEDICAMENTOS,
            EscopoAcesso.ALERGIAS,
            EscopoAcesso.LINHA_DO_TEMPO,
            EscopoAcesso.EDICAO_CLINICA,
          ],
          status: StatusCompartilhamento.ATIVO,
          dataConcessao: agora,
        },
      });
    }
  }
  await db.alergiaRestricao.create({
    data: {
      petId: pet.Thor,
      tipo: TipoAlergiaRestricao.RESTRICAO_MEDICAMENTOSA,
      descricao: 'Reação alérgica a dipirona',
      gravidade: Gravidade.GRAVE,
      dataIdentificacao: dataBrasilia(agora, -420),
    },
  });
  await db.alergiaRestricao.create({
    data: {
      petId: pet.Simba,
      tipo: TipoAlergiaRestricao.RESTRICAO_ALIMENTAR,
      descricao: 'Intolerância a frango',
      gravidade: Gravidade.MODERADA,
    },
  });

  // Histórico de vacinas: uma atrasada, uma vencendo e as demais em dia
  const vacina = async (
    petNome: string,
    nomeVacina: string,
    aplicadaHaDias: number,
    proximaEmDias: number | null,
    vet: string,
  ) => {
    const registro = await db.registroClinico.create({
      data: {
        dataRegistro: emBrasilia(agora, -aplicadaHaDias, '10:00'),
        valido: true,
        petId: pet[petNome],
        registradoPorId: vet,
      },
    });
    await db.vacinacao.create({
      data: {
        id: registro.id,
        nomeVacina,
        fabricante:
          nomeVacina.includes('raiva') || nomeVacina.includes('antirrábica')
            ? 'Zoetis'
            : 'Boehringer Ingelheim',
        lote: `L${String(100000 + aplicadaHaDias * 7).slice(0, 6)}`,
        dataAplicacao: dataBrasilia(agora, -aplicadaHaDias),
        dataProximaDose:
          proximaEmDias === null ? null : dataBrasilia(agora, proximaEmDias),
        responsavelAplicacao: `${nomeVet[vet]} · ${nomeFantasia}`,
      },
    });
  };
  await vacina('Bento', 'Vacina V10', 340, 25, funcionario.julia);
  await vacina('Bento', 'Vacina antirrábica', 340, 25, funcionario.julia);
  await vacina('Luna', 'Vacina V5 felina', 380, -15, funcionario.paulo);
  await vacina('Thor', 'Vacina V10', 200, 165, funcionario.paulo);
  await vacina('Thor', 'Vacina antirrábica', 372, -7, funcionario.paulo);
  await vacina('Mel', 'Vacina V10', 120, 245, funcionario.julia);
  await vacina('Nina', 'Vacina V10', 355, 10, funcionario.julia);
  await vacina('Simba', 'Vacina V5 felina', 90, 275, funcionario.paulo);
  await vacina('Pipoca', 'Vacina V10', 21, 0, funcionario.paulo);

  // Agenda: uma semana para trás e uma para frente
  type Slot = { pet: string; servico: ChaveServico };
  const rotacao: Slot[] = [
    { pet: 'Thor', servico: 'consulta' },
    { pet: 'Mel', servico: 'v10' },
    { pet: 'Bento', servico: 'consulta' },
    { pet: 'Nina', servico: 'hemograma' },
    { pet: 'Luna', servico: 'v5' },
    { pet: 'Simba', servico: 'consulta' },
    { pet: 'Fred', servico: 'retorno' },
    { pet: 'Pipoca', servico: 'v10' },
    { pet: 'Nina', servico: 'ultrassom' },
    { pet: 'Thor', servico: 'raiva' },
  ];
  let pagamentos = 0;
  let indice = 0;
  for (let d = -6; d <= 6; d++) {
    const semanaDia = diaDaSemanaBrasilia(agora, d);
    const vagas =
      semanaDia === 0
        ? PLANTAO_DOMINGO
        : semanaDia === 6
          ? HORARIOS.slice(0, 3)
          : HORARIOS.filter((_, i) => (i + d + 7) % 4 !== 3);
    // Hoje, o último horário que já começou fica esperando o atendimento: a qualquer hora do dia,
    // quem abre a demonstração tem um atendimento para registrar (o registro só vale depois do horário).
    const emAberto =
      d === 0
        ? vagas.reduce(
            (ultimo, h, i) => (emBrasilia(agora, 0, h) <= agora ? i : ultimo),
            -1,
          )
        : -1;
    for (const [i, horario] of vagas.entries()) {
      const slot = rotacao[indice++ % rotacao.length];
      const servico = idServico[slot.servico];
      const vet = veterinarios[(i + d + 13) % 2];
      const inicio = emBrasilia(agora, d, horario);
      const fim = new Date(inicio.getTime() + servico.duracao * 60_000);
      let status: StatusAgendamento =
        fim <= agora && i !== emAberto
          ? StatusAgendamento.REALIZADO
          : StatusAgendamento.AGENDADO;
      if (d === -2 && i === 1) status = StatusAgendamento.NAO_COMPARECEU;
      if (d === -4 && i === 2) status = StatusAgendamento.CANCELADO;
      const agendamento = await db.agendamento.create({
        data: {
          dataHoraInicio: inicio,
          dataHoraFim: fim,
          precoContratado: servico.preco,
          status,
          // Metade dos próximos já confirmados pelo tutor no lembrete
          confirmadoEm:
            status === StatusAgendamento.AGENDADO && (i + d) % 2 === 0
              ? new Date(agora.getTime() - 3 * 3_600_000)
              : null,
          criadoEm: emBrasilia(agora, d - 5, '12:00'),
          servicoId: servico.id,
          petId: pet[slot.pet],
          profissionalId: vet,
          recursoId: consultorios[(i + d + 13) % 2],
        },
      });
      if (status !== StatusAgendamento.REALIZADO) continue;

      await db.atendimento.create({
        data: {
          dataHoraInicio: inicio,
          dataHoraFim: fim,
          procedimentosRealizados: procedimentos(slot.servico),
          observacoesClinicas: observacao(slot.servico, slot.pet),
          status: StatusAtendimento.FINALIZADO,
          finalizadoEm: fim,
          agendamentoId: agendamento.id,
          petId: pet[slot.pet],
          registradoPorId: vet,
          profissionalId: vet,
          itemAtendimento: {
            create: [
              {
                quantidade: 1,
                valorUnitario: servico.preco,
                servicoId: servico.id,
              },
            ],
          },
        },
      });
      // Hoje e ontem ficam cobranças em aberto; o resto já foi pago.
      const pago = d < -1 || (d === -1 && i % 2 === 0);
      await db.pagamento.create({
        data: {
          codigoTransacao: `demo-${sufixo}-${++pagamentos}`,
          valor: servico.preco,
          dataHora: fim,
          metodo: [
            MetodoPagamento.PIX,
            MetodoPagamento.CARTAO_CREDITO,
            MetodoPagamento.CARTAO_DEBITO,
          ][pagamentos % 3],
          status: pago ? StatusPagamento.ACEITO : StatusPagamento.PENDENTE,
          dataConfirmacao: pago ? new Date(fim.getTime() + 15 * 60_000) : null,
          pagadorId: donoDoPet[slot.pet],
          recebedorId: empresaId,
          agendamentoId: agendamento.id,
        },
      });
    }
  }

  // Pedidos de agendamento esperando resposta da clínica
  const pedidos: {
    pet: string;
    servico: ChaveServico;
    dias: number;
    hora: string;
    obs: string;
  }[] = [
    {
      pet: 'Luna',
      servico: 'v5',
      dias: 1,
      hora: '10:00',
      obs: 'A vacina dela está atrasada.',
    },
    {
      pet: 'Fred',
      servico: 'consulta',
      dias: 2,
      hora: '15:00',
      obs: 'Está coçando muito as orelhas.',
    },
    {
      pet: 'Pipoca',
      servico: 'raiva',
      dias: 3,
      hora: '09:00',
      obs: null as unknown as string,
    },
  ];
  for (const p of pedidos) {
    await db.solicitacaoServico.create({
      data: {
        dataSolicitacao: new Date(agora.getTime() - 40 * 60_000),
        dataHoraDesejada: emBrasilia(agora, diaUtil(agora, p.dias), p.hora),
        status: StatusSolicitacao.PENDENTE,
        observacoes: p.obs ?? undefined,
        tutorId: donoDoPet[p.pet],
        petId: pet[p.pet],
        servicoId: idServico[p.servico].id,
      },
    });
  }

  // Conversa da tutora principal com a clínica
  const conversa = await db.conversa.create({
    data: {
      tipo: TipoConversa.EMPRESA,
      dataInicio: emBrasilia(agora, -1, '18:10'),
      status: StatusConversa.ABERTA,
      tutorId: tutorPrincipal,
      empresaId,
      petId: pet.Luna,
    },
  });
  const mensagens: [string | null, string, number][] = [
    [
      tutorPrincipal,
      'Oi! A Luna pode tomar a vacina mesmo tendo espirrado um pouco ontem?',
      0,
    ],
    [
      empresaId,
      'Oi, Marina! Se ela estiver comendo bem e sem febre, pode sim. A Dra. Júlia avalia antes de aplicar.',
      12,
    ],
    [tutorPrincipal, 'Perfeito, pedi o horário de amanhã pelo app.', 20],
  ];
  for (const [remetenteId, conteudo, minutos] of mensagens) {
    await db.mensagem.create({
      data: {
        conversaId: conversa.id,
        remetenteId,
        conteudo,
        dataHoraEnvio: new Date(
          emBrasilia(agora, -1, '18:10').getTime() + minutos * 60_000,
        ),
        lida: remetenteId !== tutorPrincipal,
      },
    });
  }

  // Termos vigentes já aceitos pelas contas que entram, para a demonstração abrir direto
  await aceitarTermos(
    db,
    empresaId,
    [TipoTermo.TERMOS_ENTERPRISE, TipoTermo.POLITICA_PRIVACIDADE],
    agora,
    op.ipOrigem ?? '127.0.0.1',
  );
  await aceitarTermos(
    db,
    tutorPrincipal,
    [TipoTermo.TERMOS_USO_APP, TipoTermo.POLITICA_PRIVACIDADE],
    agora,
    op.ipOrigem ?? '127.0.0.1',
  );

  return { empresaId, tutorId: tutorPrincipal };
}

/** Deslocamento em dias até o n-ésimo dia útil (segunda a sexta) depois de hoje. */
function diaUtil(agora: Date, n: number): number {
  let dias = 0;
  let contados = 0;
  while (contados < n) {
    dias++;
    const semana = diaDaSemanaBrasilia(agora, dias);
    if (semana !== 0 && semana !== 6) contados++;
  }
  return dias;
}

async function aceitarTermos(
  db: Db,
  usuarioId: string,
  tipos: TipoTermo[],
  agora: Date,
  ipOrigem: string,
) {
  for (const tipo of tipos) {
    const termo = await db.termoUso.findFirst({
      where: { tipo, dataVigencia: { lte: agora } },
      orderBy: { dataVigencia: 'desc' },
    });
    if (!termo) continue;
    await db.consentimento.create({
      data: {
        aceito: true,
        dataAceite: agora,
        meioColeta: MeioColeta.ACEITE_NO_APP,
        ipOrigem,
        usuarioId,
        termoId: termo.id,
      },
    });
  }
}

function procedimentos(servico: string): string {
  switch (servico) {
    case 'consulta':
      return 'Anamnese, exame físico completo, ausculta cardíaca e pulmonar, aferição de temperatura e peso.';
    case 'retorno':
      return 'Reavaliação clínica após tratamento; lesões em regressão.';
    case 'hemograma':
      return 'Coleta de sangue para hemograma completo.';
    case 'ultrassom':
      return 'Ultrassonografia abdominal completa.';
    default:
      return 'Avaliação clínica pré-vacinal e aplicação da vacina por via subcutânea.';
  }
}

function observacao(servico: string, petNome: string): string | null {
  if (servico === 'consulta')
    return `${petNome} em bom estado geral. Orientado retorno em 30 dias se os sintomas voltarem.`;
  if (servico === 'hemograma') return 'Resultado disponível em até 24 horas.';
  return null;
}
