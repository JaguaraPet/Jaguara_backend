import { execSync } from 'node:child_process';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';

declare global {
  var __CONTEINERES_TESTE__:
    [StartedPostgreSqlContainer, StartedRedisContainer] | undefined;
}

/**
 * Sobe um PostgreSQL 16 e um Redis 7 descartáveis (Testcontainers) para os testes de
 * integração e de API, aplica as migrações e aponta DATABASE_URL e REDIS_URL para eles.
 * Cada execução começa com um banco novo e vazio (TST-01, seção 4).
 */
export default async function prepararAmbienteDeTeste() {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('jaguara_teste')
      .withUsername('jaguara')
      .withPassword('jaguara')
      .start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);

  process.env.DATABASE_URL = postgres.getConnectionUri();
  process.env.REDIS_URL = redis.getConnectionUrl();

  execSync('npx prisma migrate deploy', {
    env: process.env,
    stdio: 'ignore',
  });

  globalThis.__CONTEINERES_TESTE__ = [postgres, redis];
}
