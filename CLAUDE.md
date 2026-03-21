See @README.md for project overview and command line development commands for this project.

## Cloudflare Workers

STOP. Your knowledge of Cloudflare Workers APIs and limits may be outdated. Always retrieve current documentation before any Workers, KV, R2, D1, Durable Objects, Queues, Vectorize, AI, or Agents SDK task.

### MCP Documentation Server

The Cloudflare docs MCP server is available. Use it for all Cloudflare documentation lookups:

- Tool: `mcp__plugin_cloudflare_cloudflare-docs__search_cloudflare_documentation`
- Tool: `mcp__plugin_cloudflare_cloudflare-docs__migrate_pages_to_workers_guide`

Prefer the MCP server over WebFetch for Cloudflare docs — it returns structured, current content directly.

### Skills

Cloudflare-specific skills are available via the Skill tool. Use them for specialized tasks:

- `cloudflare:workers-best-practices` — reviewing/authoring Worker code, wrangler config, anti-patterns
- `cloudflare:wrangler` — wrangler CLI commands (deploy, dev, KV, R2, D1, secrets, etc.)
- `cloudflare:durable-objects` — Durable Objects, RPC, SQLite storage, alarms, WebSockets
- `cloudflare:cloudflare` — general Cloudflare platform (Workers, KV, D1, R2, AI, networking, security)
