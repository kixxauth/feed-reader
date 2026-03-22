import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				wrangler: { configPath: './wrangler.jsonc' },
				miniflare: {
					bindings: {
						GITHUB_CLIENT_ID: 'test-client-id',
						GITHUB_CLIENT_SECRET: 'test-client-secret',
						ALLOWED_EMAILS: 'allowed@example.com',
					},
				},
			},
		},
	},
});
