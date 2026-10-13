import { defineConfig } from 'drizzle-kit'

// Used only by `npx drizzle-kit generate` (dev tool). The app applies migrations itself (src/main/db/migrate.ts).
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/db/schema.ts',
  out: './src/main/db/migrations'
})
