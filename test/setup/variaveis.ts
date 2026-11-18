// Carrega o .env sem sobrescrever DATABASE_URL e REDIS_URL definidos pelo global-setup.
import 'dotenv/config';

process.env.NODE_ENV = 'test';
