import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Sem DATABASE_URL (por exemplo, no `prisma generate` do build) usa o banco local.
    url:
      process.env.DATABASE_URL ??
      'postgresql://jaguara:jaguara@localhost:5432/jaguara',
  },
});
