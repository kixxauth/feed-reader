/**
 * Vitest global setup — runs once in the Node.js host process before any tests.
 *
 * Suppresses the workerd "A header value for MF-Vitest-Source contains
 * non-ASCII characters" warning. This header is written by
 * @cloudflare/vitest-pool-workers to carry test-source metadata between
 * miniflare's Node.js side and the workerd subprocess. workerd's HTTP
 * validator flags it as non-ASCII on every request, producing one noisy
 * log line per test. The warning is benign — it has no effect on test
 * behaviour.
 */
export function setup() {
	const originalWrite = process.stderr.write.bind(process.stderr);
	process.stderr.write = (chunk, ...args) => {
		const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
		if (text.includes('MF-Vitest-Source')) {
			const cb = typeof args[0] === 'function' ? args[0] : args[1];
			if (typeof cb === 'function') cb();
			return true;
		}
		return originalWrite(chunk, ...args);
	};
}
