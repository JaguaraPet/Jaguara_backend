/**
 * Catálogo de permissões do RBAC (ADR-009, ADR-012). Cada rota declara as permissões que exige
 * com `@Permissoes(...)`; os perfis de acesso agrupam permissões (RN20).
 * Código no formato `recurso:acao`.
 */
export const PERMISSOES = {
  // Tutor (app)
  'pet:ler': { modulo: 'pet', descricao: 'Ver os próprios pets' },
  'pet:editar': {
    modulo: 'pet',
    descricao: 'Cadastrar e editar os próprios pets',
  },
  'saude:ler': {
    modulo: 'saude',
    descricao: 'Ver o histórico de saúde dos pets',
  },
  'saude:editar': {
    modulo: 'saude',
    descricao: 'Registrar vacinas, exames, medicamentos e alergias',
  },
  'rotina:ler': {
    modulo: 'rotina',
    descricao: 'Ver calendário, alimentação e despesas',
  },
  'rotina:editar': {
    modulo: 'rotina',
    descricao: 'Registrar eventos, alimentação e despesas',
  },
  'compartilhamento:gerenciar': {
    modulo: 'pet',
    descricao: 'Compartilhar pets com empresas e responsáveis',
  },
  'solicitacao:criar': {
    modulo: 'atendimento',
    descricao: 'Solicitar serviços a empresas',
  },
  'pagamento:realizar': {
    modulo: 'financeiro',
    descricao: 'Pagar serviços e a assinatura PANTERA',
  },
  'chat:usar': {
    modulo: 'comunicacao',
    descricao: 'Conversar com empresas e com o assistente',
  },
  'notificacao:configurar': {
    modulo: 'notificacao',
    descricao: 'Configurar preferências de notificação',
  },
  'privacidade:solicitar': {
    modulo: 'privacidade',
    descricao: 'Pedir exportação, correção ou exclusão de dados',
  },

  // Empresa Enterprise (web)
  'empresa:editar': {
    modulo: 'atendimento',
    descricao: 'Editar os dados da empresa',
  },
  'funcionario:ler': { modulo: 'acesso', descricao: 'Ver funcionários' },
  'funcionario:editar': {
    modulo: 'acesso',
    descricao: 'Cadastrar, editar e remover funcionários',
  },
  'perfil:editar': {
    modulo: 'acesso',
    descricao: 'Criar e editar perfis de acesso da empresa',
  },
  'servico:ler': {
    modulo: 'atendimento',
    descricao: 'Ver o catálogo de serviços',
  },
  'servico:editar': {
    modulo: 'atendimento',
    descricao: 'Cadastrar e editar serviços',
  },
  'recurso:editar': {
    modulo: 'atendimento',
    descricao: 'Cadastrar recursos e horários de atuação',
  },
  'agenda:ler': { modulo: 'atendimento', descricao: 'Ver a agenda' },
  'agenda:editar': {
    modulo: 'atendimento',
    descricao: 'Aceitar solicitações e gerenciar agendamentos',
  },
  'atendimento:ler': { modulo: 'atendimento', descricao: 'Ver atendimentos' },
  'atendimento:editar': {
    modulo: 'atendimento',
    descricao: 'Registrar e alterar atendimentos',
  },
  'cliente:ler': {
    modulo: 'atendimento',
    descricao: 'Ver clientes e pets atendidos',
  },
  'cliente:editar': {
    modulo: 'atendimento',
    descricao: 'Cadastrar e editar clientes',
  },
  'financeiro:ler': {
    modulo: 'financeiro',
    descricao: 'Ver recebimentos e cobranças',
  },
  'integracao:editar': {
    modulo: 'administracao',
    descricao: 'Configurar integrações e webhooks da empresa',
  },
  'relatorio:ler': { modulo: 'relatorios', descricao: 'Ver relatórios' },

  // Administrador da plataforma (web /admin)
  'admin:usuarios': {
    modulo: 'administracao',
    descricao: 'Gerenciar contas de usuários',
  },
  'admin:empresas': {
    modulo: 'administracao',
    descricao: 'Gerenciar empresas',
  },
  'admin:termos': {
    modulo: 'privacidade',
    descricao: 'Publicar termos e políticas',
  },
  'admin:suporte': {
    modulo: 'administracao',
    descricao: 'Atender chamados de suporte',
  },
  'admin:auditoria': {
    modulo: 'administracao',
    descricao: 'Consultar o log de auditoria',
  },
  'admin:integracoes': {
    modulo: 'administracao',
    descricao: 'Gerenciar integrações da plataforma',
  },
} as const;

export type CodigoPermissao = keyof typeof PERMISSOES;

export const TUTOR: CodigoPermissao[] = [
  'pet:ler',
  'pet:editar',
  'saude:ler',
  'saude:editar',
  'rotina:ler',
  'rotina:editar',
  'compartilhamento:gerenciar',
  'solicitacao:criar',
  'pagamento:realizar',
  'chat:usar',
  'notificacao:configurar',
  'privacidade:solicitar',
];

export const EMPRESA_TODAS: CodigoPermissao[] = [
  'empresa:editar',
  'funcionario:ler',
  'funcionario:editar',
  'perfil:editar',
  'servico:ler',
  'servico:editar',
  'recurso:editar',
  'agenda:ler',
  'agenda:editar',
  'atendimento:ler',
  'atendimento:editar',
  'cliente:ler',
  'cliente:editar',
  'financeiro:ler',
  'integracao:editar',
  'relatorio:ler',
  'chat:usar',
  'notificacao:configurar',
];

/** Perfis criados para toda a plataforma (escopo GLOBAL). */
export const PERFIS_GLOBAIS = {
  Tutor: { descricao: 'Tutor de pets no app', permissoes: TUTOR },
  Administrador: {
    descricao: 'Administrador da plataforma Jaguara',
    permissoes: [
      'admin:usuarios',
      'admin:empresas',
      'admin:termos',
      'admin:suporte',
      'admin:auditoria',
      'admin:integracoes',
      'relatorio:ler',
    ] as CodigoPermissao[],
  },
} as const;

/** Perfis criados para cada empresa nova (escopo EMPRESA); a empresa pode criar outros (RN20). */
export const PERFIS_EMPRESA_PADRAO = {
  Proprietário: {
    descricao: 'Acesso total à empresa',
    permissoes: EMPRESA_TODAS,
  },
  Atendente: {
    descricao: 'Recepção: agenda, clientes e solicitações',
    permissoes: [
      'servico:ler',
      'agenda:ler',
      'agenda:editar',
      'atendimento:ler',
      'cliente:ler',
      'cliente:editar',
      'chat:usar',
      'notificacao:configurar',
    ] as CodigoPermissao[],
  },
  Profissional: {
    descricao: 'Veterinário, tosador ou cuidador: agenda e atendimentos',
    permissoes: [
      'servico:ler',
      'agenda:ler',
      'atendimento:ler',
      'atendimento:editar',
      'cliente:ler',
      'chat:usar',
      'notificacao:configurar',
    ] as CodigoPermissao[],
  },
} as const;
