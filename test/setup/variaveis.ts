// Carrega o .env sem sobrescrever DATABASE_URL e REDIS_URL definidos pelo global-setup.
import 'dotenv/config';

process.env.NODE_ENV = 'test';
// Antes de importar a API: o ConfigModule lê o ambiente no import. Provedores externos ficam
// simulados e o webhook do gateway usa um segredo só de teste.
process.env.MP_ACCESS_TOKEN = '';
process.env.MP_WEBHOOK_SEGREDO = 'segredo-webhook-teste';
// Login social (RF46): IDs de cliente só de teste; o verificador de assinatura é trocado nos testes.
process.env.GOOGLE_LOGIN_CLIENT_IDS =
  'cliente-teste.apps.googleusercontent.com';
process.env.APPLE_CLIENT_ID = 'br.com.jaguarapet.app';
