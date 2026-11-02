import { defineConfig } from 'vitest/config';

// Dedicated config: `npx vitest run --config vitest.templates.config.ts` regenerates the four
// built-in map templates (app/Domain/Maps/templates). Not part of the regular test suite.
export default defineConfig({
  test: {
    include: ['scripts/build-templates.ts'],
    environment: 'node',
  },
});
