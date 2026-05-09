# kp-mcp

MCP server for [kupujemprodajem.com](https://www.kupujemprodajem.com) (KP) — Serbia's largest classifieds site. Lets Claude search KP listings and pull full ad details, then reason about the best match against your requirements.

Two transports from one codebase:

- **stdio** — for Claude Code and Claude Desktop (local install).
- **streamable HTTP** — for Claude.ai workspace as a custom connector, or any remote MCP host.

## Tools

| Tool | Description |
|---|---|
| `search_kp` | Search KP with filters (price range, currency, condition, category, order, page). Returns structured product list. |
| `fetch_listing` | Fetch full detail (description, all photos, complete seller profile, car-specific fields) for a single ad URL. |

## Install

```bash
pnpm install
pnpm build
```

## Run — local stdio

```bash
pnpm start:stdio    # node dist/stdio.js
```

Register with **Claude Code** (project-scoped via `.mcp.json`):

```jsonc
{
  "mcpServers": {
    "kp": {
      "command": "node",
      "args": ["/absolute/path/to/kp-mcp/dist/stdio.js"]
    }
  }
}
```

…or globally with the CLI:

```bash
claude mcp add kp -- node /absolute/path/to/kp-mcp/dist/stdio.js
```

Once published to npm, you can replace the absolute path with `npx -y kp-mcp`.

For **Claude Desktop**, add the same block to `claude_desktop_config.json`.

## Run — remote HTTP

```bash
PORT=3000 pnpm start:http
```

Endpoint: `POST/GET/DELETE http://localhost:3000/mcp` (streamable HTTP). Health check at `/health`.

Register with **Claude Code**:

```bash
claude mcp add --transport http kp http://localhost:3000/mcp
```

Use as a **Claude.ai Custom Connector**: deploy somewhere with HTTPS (Vercel, Fly, Render, Railway, …), then add the public `https://…/mcp` URL in Settings → Connectors.

### Deploy notes

- **Node 18+** required. `fetch` and `crypto.randomUUID` are used directly from the Node runtime — no shell-out, no JSDOM.
- The server is stateless across restarts but keeps per-session state in memory. For horizontal scaling, pin sessions to instances or move session storage to Redis.
- Cloudflare Workers needs a Workers-specific MCP transport; this scaffold targets Node hosts.

## Develop

```bash
pnpm dev:stdio          # tsx, no rebuild loop
pnpm dev:http
pnpm typecheck
pnpm inspect            # MCP Inspector against built dist/stdio.js
```

## License

MIT
