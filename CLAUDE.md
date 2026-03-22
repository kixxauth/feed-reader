See @README.md for project overview and command line development commands for this project.

## Cloudflare Workers

DO NOT ever deploy this Worker to Cloudflare. This project uses manual deploys only. You *may* prompt to the user to deploy it, but NEVER deploy it yourself without being explicitly asked to do so by the user.

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

## Development Server
After starting the development server (`npm start` or `npx wrangler dev`) for testing or validation: BE SURE to kill the server to free up the port for development or testing use.

## Web Development Framework
This project uses the Hono web development framework for HTTP request handling and server-side rendering of HTML from the Cloudflare Worker.

The full documentation for Hono, including Cloudflare Worker bindings, is available online in Markdown format. Use it for all Hono documentation lookups: https://hono.dev/llms-full.txt
