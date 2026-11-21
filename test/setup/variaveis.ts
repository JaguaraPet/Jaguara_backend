// Carrega o .env sem sobrescrever DATABASE_URL e REDIS_URL definidos pelo global-setup.
import 'dotenv/config';

process.env.NODE_ENV = 'test';
// Antes de importar a API: o ConfigModule lê o ambiente no import. Provedores externos ficam
// simulados e o webhook do gateway usa um segredo só de teste.
process.env.MP_ACCESS_TOKEN = '';
process.env.MP_WEBHOOK_SEGREDO = 'segredo-webhook-teste';
