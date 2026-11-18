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

  URL_WEB: z.url(),
  URL_APP: z.string().min(1),
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
