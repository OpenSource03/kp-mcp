# kp-mcp

[🇷🇸 Srpski](README.md) · 🇬🇧 **English**

[![Deploy](https://github.com/OpenSource03/kp-mcp/actions/workflows/deploy.yml/badge.svg)](https://github.com/OpenSource03/kp-mcp/actions/workflows/deploy.yml)
[![npm version](https://img.shields.io/npm/v/@opensource03/kp-mcp?color=cb3837&logo=npm)](https://www.npmjs.com/package/@opensource03/kp-mcp)
[![npm downloads](https://img.shields.io/npm/dm/@opensource03/kp-mcp?color=cb3837)](https://www.npmjs.com/package/@opensource03/kp-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-7c3aed)](https://modelcontextprotocol.io)

MCP (Model Context Protocol) server for [kupujemprodajem.com](https://www.kupujemprodajem.com) — Serbia's largest classifieds marketplace. Lets any MCP-compatible AI assistant (Claude, ChatGPT, Cursor, Continue, Cline, Windsurf, Zed, etc.) search KP listings and read full ad details.

## What it provides

Three tools, all behind one MCP endpoint:

| Tool | What it does |
|---|---|
| `list_kp_categories` | KP taxonomy lookup — **always call first** to get the right `categoryId` / `groupId`. 88 categories, ~1170 groups, baked in. |
| `search_kp` | Listing search with filters: price (EUR/RSD), condition, ordering, pagination, scope (title/description). |
| `fetch_listing` | Full detail for one ad: description, all photos, seller profile (reviews, verification), category-specific fields (cars: year/km/fuel, real estate: location, etc). |

All tools render interactive UI widgets in hosts that implement the MCP Apps spec (Claude Desktop, claude.ai, etc.); otherwise they degrade gracefully to plain text.

## Usage — hosted endpoint (recommended)

Easiest path — use the public endpoint hosted on infrastructure with a Serbian IP (KP serves much better results to local IPs):

**`https://kp.osrc.io/mcp`**

Add as a "Custom Connector" in your AI host (claude.ai → Settings → Connectors, Cursor → MCP Servers, etc.). No auth.

## Local (npx, no install)

The easiest local option — no clone, no build, just Node 20+:

```jsonc
// .mcp.json (Claude Code) or claude_desktop_config.json
{
  "mcpServers": {
    "kp": {
      "command": "npx",
      "args": ["-y", "@opensource03/kp-mcp"]
    }
  }
}
```

Same format works for Cursor / Continue / Cline / Windsurf / Zed — just in their MCP config file. First run pulls the package from npm (~5 s); subsequent runs are cached.

Run directly from a terminal (for testing):
```bash
npx -y @opensource03/kp-mcp                  # stdio mode
PORT=3000 npx -y -p @opensource03/kp-mcp kp-mcp-http   # HTTP mode on port 3000
```

## Local (from git source)

If you want to modify the code:

```bash
git clone https://github.com/OpenSource03/kp-mcp.git
cd kp-mcp && pnpm install && pnpm build
```

Register with the absolute path to `dist/stdio.js`:

```jsonc
{ "mcpServers": { "kp": { "command": "node", "args": ["/absolute/path/to/kp-mcp/dist/stdio.js"] } } }
```

## Self-hosted HTTP

```bash
PORT=3000 pnpm start:http
```

Endpoint: `POST/GET/DELETE http://localhost:3000/mcp` (streamable HTTP). Health check at `/health`.

For public exposure use any reverse proxy or tunnel.

## Usage tips

KP's search has a few quirks — tool descriptions guide the model toward good queries, but here's the gist:

- **Always call `list_kp_categories` first** — dramatically improves result quality. Otherwise "RTX 3090" sorted by price returns 27€ water blocks.
- **Don't pad queries** with "graficka karta", "telefon", "auto". Model codes are unique: 'RTX 3090' works, 'RTX 3090 graficka karta' returns 0.
- **Pair `priceFrom` with `currency`**. KP mixes EUR and RSD in one result set.
- **`fetch_listing` is preferred** before recommending any listing — search results don't carry seller reviews, car year/km, or full photos.
- **Both Latin and Cyrillic work**. Diacritics are optional ('frizider' ≡ 'frižider').

## Development

```bash
pnpm dev:stdio          # tsx watch, no rebuild loop
pnpm dev:http
pnpm typecheck
pnpm inspect            # MCP Inspector against built dist/stdio.js
```

## Architecture

- TypeScript, strict mode, no `any`, no `as` casts outside system boundaries
- Native `fetch`, regex parsing of `__NEXT_DATA__` (no JSDOM — runs on Node, edge, Workers)
- In-memory cookie jar for KP session stability
- Images inlined as `data:` URLs (CSP fallback for hosts that don't honour `csp.resourceDomains`)

## License

MIT
