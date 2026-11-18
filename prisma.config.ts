import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node --transpile-only prisma/seed.ts',
  },
  datasource: {
    // Sem DATABASE_URL (por exemplo, no `prisma generate` do build) usa o banco local.
    url:
      process.env.DATABASE_URL ??
      'postgresql://jaguara:jaguara@localhost:5432/jaguara',
  },
});
