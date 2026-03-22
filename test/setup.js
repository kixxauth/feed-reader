import { env, applyD1Migrations } from 'cloudflare:test';
import { beforeAll } from 'vitest';

// Apply all D1 migrations before any tests run in this file.
// The migrations array was passed in via the TEST_MIGRATIONS binding in vitest.config.js.
beforeAll(async () => {
	await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
