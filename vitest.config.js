import path from 'node:path';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig(async () => {
	// Read the D1 migration files so they can be applied in the test setup file.
	const migrationsPath = path.join(import.meta.dirname, 'migrations');
	const migrations = await readD1Migrations(migrationsPath);

	return {
		test: {
			setupFiles: ['./test/setup.js'],
			poolOptions: {
				workers: {
					wrangler: { configPath: './wrangler.jsonc' },
					miniflare: {
						bindings: {
							GITHUB_CLIENT_ID: 'test-client-id',
							GITHUB_CLIENT_SECRET: 'test-client-secret',
							ALLOWED_EMAILS: 'allowed@example.com',
							// Pass migrations array as a binding so the setup file can apply them
							TEST_MIGRATIONS: migrations,
						},
					},
				},
			},
		},
	};
});
