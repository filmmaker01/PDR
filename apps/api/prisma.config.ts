import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Prisma 6 с конфиг-файлом больше не читает .env сам.
loadDotenv({ path: '.env', quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { seed: 'tsx prisma/seed.ts' },
});
