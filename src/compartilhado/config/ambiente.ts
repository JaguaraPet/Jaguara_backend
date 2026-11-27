import { z } from 'zod';

/** Variáveis de ambiente da API e do worker, validadas na inicialização (ENT-01, seção 3). */
export const esquemaAmbiente = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),

  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET precisa de pelo menos 32 caracteres'),
  JWT_EXPIRACAO_MINUTOS: z.coerce.number().int().positive().default(15),
  SESSAO_INATIVIDADE_HORAS: z.coerce.number().int().positive().default(4),

  CHAVE_CRIPTOGRAFIA: z
    .base64()
    .refine((valor) => Buffer.from(valor, 'base64').length === 32, {
      message: 'CHAVE_CRIPTOGRAFIA precisa ter 32 bytes em base64 (AES-256)',
    }),

  S3_ENDPOINT: z.url(),
  S3_REGIAO: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),

  EMAIL_PROVEDOR: z.enum(['smtp', 'api']).default('smtp'),
  EMAIL_REMETENTE: z.string().min(1),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORTA: z.coerce.number().int().positive().default(1025),
  EMAIL_API_KEY: z.string().optional(),

  // Uma ou mais origens separadas por vírgula; a primeira é a usada nos links dos e-mails.
  URL_WEB: z
    .string()
    .min(1)
    .refine(
      (valor) =>
        valor.split(',').every((url) => z.url().safeParse(url.trim()).success),
      {
        message:
          'URL_WEB precisa ser uma URL ou uma lista de URLs separadas por vírgula',
      },
    ),
  URL_APP: z.string().min(1),

  // Assistente virtual (ARQ-03, seção 3.5). Sem chave, o assistente responde simulado.
  ANTHROPIC_API_KEY: z.string().optional(),
  IA_MODELO: z.string().optional(),
  IA_LIMITE_DIARIO: z.coerce.number().int().positive().default(30),

  // Preço mensal do PANTERA enquanto a QA-02 não fecha o valor (GES-09).
  PANTERA_PRECO_MENSAL: z.coerce.number().positive().default(14.9),

  // Gateway de pagamento (ARQ-03, seção 3.1). Sem token, o gateway é simulado.
  MP_ACCESS_TOKEN: z.string().optional(),
  MP_WEBHOOK_SEGREDO: z.string().optional(),
  // Vazio no .env.example conta como não informado.
  URL_API_PUBLICA: z.preprocess(
    (valor) => (valor === '' ? undefined : valor),
    z.url().optional(),
  ),

  // Push pelo Expo (ARQ-03, UC-31). Desligado, o push é só registrado no log.
  PUSH_EXPO: z.preprocess(
    (valor) => valor === 'true' || valor === true,
    z.boolean(),
  ),
  // Google Agenda (UC-09). Sem as duas, o calendário externo é simulado.
  GOOGLE_CLIENT_ID: z.preprocess(
    (valor) => (valor === '' ? undefined : valor),
    z.string().optional(),
  ),
  GOOGLE_CLIENT_SECRET: z.preprocess(
    (valor) => (valor === '' ? undefined : valor),
    z.string().optional(),
  ),
  // Login social (UC-02 FA04, RF46): IDs de cliente aceitos no id_token. Vazios: login social desligado.
  GOOGLE_LOGIN_CLIENT_IDS: z.preprocess(
    (valor) => (valor === '' ? undefined : valor),
    z.string().optional(),
  ),
  APPLE_CLIENT_ID: z.preprocess(
    (valor) => (valor === '' ? undefined : valor),
    z.string().optional(),
  ),
  EXPO_ACCESS_TOKEN: z.preprocess(
    (valor) => (valor === '' ? undefined : valor),
    z.string().optional(),
  ),
  // Demonstração pública (clínica temporária por visitante). Desligada por padrão.
  DEMONSTRACAO_HABILITADA: z.preprocess(
    (valor) => valor === 'true' || valor === true,
    z.boolean(),
  ),
  DEMONSTRACAO_HORAS: z.coerce.number().int().positive().default(48),
  // Formulário de opinião mostrado na demonstração (Google Forms ou similar).
  URL_FORMULARIO_OPINIAO: z.preprocess(
    (valor) => (valor === '' ? undefined : valor),
    z.url().optional(),
  ),
  // Versão web do app do tutor, para o "Ver como tutor" da demonstração.
  URL_TUTOR_WEB: z.preprocess(
    (valor) => (valor === '' ? undefined : valor),
    z.url().optional(),
  ),
});

export type Ambiente = z.infer<typeof esquemaAmbiente>;

export function validarAmbiente(config: Record<string, unknown>): Ambiente {
  const resultado = esquemaAmbiente.safeParse(config);
  if (!resultado.success) {
    const erros = resultado.error.issues
      .map((erro) => `- ${erro.path.join('.')}: ${erro.message}`)
      .join('\n');
    throw new Error(`Variáveis de ambiente inválidas:\n${erros}`);
  }
  return resultado.data;
}
