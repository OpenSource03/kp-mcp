# kp-mcp

[![Deploy to Coolify](https://github.com/OpenSource03/kp-mcp/actions/workflows/deploy.yml/badge.svg)](https://github.com/OpenSource03/kp-mcp/actions/workflows/deploy.yml)

MCP (Model Context Protocol) server za [kupujemprodajem.com](https://www.kupujemprodajem.com) — najveći oglasnik u Srbiji. Omogućava bilo kom AI asistentu koji podržava MCP (Claude, ChatGPT, Cursor, Continue, Cline, Windsurf, Zed i drugi) da pretražuje KP oglase i čita pune detalje pojedinačnih oglasa.

> [English version below ↓](#english)

## Šta nudi

Tri alata, sve dostupno preko jednog MCP endpoint-a:

| Alat | Šta radi |
|---|---|
| `list_kp_categories` | Pretraga taksonomije KP-a — **uvek prvo pozvati** za pravi `categoryId` / `groupId`. 88 kategorija, ~1170 grupa, baked-in. |
| `search_kp` | Pretraga oglasa sa filterima: cena (EUR/RSD), stanje, sortiranje, paginacija, scope (title/description). |
| `fetch_listing` | Pun detalj jednog oglasa: opis, sve fotografije, profil prodavca (recenzije, verifikacija), specifikacije za auto / nekretnine. |

Oba alata renderuju interaktivne UI widgete u host-ovima koji podržavaju MCP Apps spec (Claude Desktop, claude.ai, i ostali); inače padaju nazad na čist tekst.

## Instalacija — daljinski (preporučeno)

Najlakši način — koristi javni endpoint koji se hostuje na Raspberry Pi-u sa rezidencijalnom srpskom IP adresom (KP ne servira "stripped" anti-bot stranicu rezidencijalnim IP-jevima):

**`https://kp.osrc.io/mcp`**

Dodaj kao "Custom Connector" u svoj AI host (claude.ai → Settings → Connectors, Cursor → MCP Servers, itd.). Bez autorizacije.

## Instalacija — lokalno (stdio)

Za potpunu kontrolu / offline rad / rad na svojoj IP adresi:

```bash
git clone https://github.com/OpenSource03/kp-mcp.git
cd kp-mcp
pnpm install
pnpm build
```

Registracija u Claude Code (project-scoped `.mcp.json`):

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

Za Claude Desktop dodaj isti blok u `claude_desktop_config.json`. Za druge MCP klijente — bilo šta što izvrši `node dist/stdio.js` i komunicira preko stdin/stdout-a.

## Instalacija — daljinski self-hosted (HTTP)

```bash
PORT=3000 pnpm start:http
```

Endpoint: `POST/GET/DELETE http://localhost:3000/mcp` (streamable HTTP). Health check na `/health`.

Za javnu izloženost koristi Cloudflare Tunnel (besplatan, podržava WebSocket-ove iz kutije) ili bilo koji reverse proxy.

## Saveti za korišćenje

KP-ova pretraga ima nekoliko specifičnosti — alati su podešeni da modeli prave dobre zahteve, ali evo šta treba znati:

- **Uvek koristi `list_kp_categories` prvo** — drastično poboljšava kvalitet rezultata. Inače "RTX 3090" sortiran po ceni vraća vodene blokove od 27€.
- **Ne dodaji "graficka karta", "telefon", "auto"** u pretragu. Modeli kodovi su jedinstveni: 'RTX 3090' radi, 'RTX 3090 graficka karta' vraća 0.
- **Pratiti `priceFrom` sa `currency`**. KP servira oglase i u EUR i u RSD u istoj listi.
- **`fetch_listing`** je "praktično obavezan" pre nego što preporučiš oglas — search rezultati ne sadrže recenzije prodavca, godišta auta, ili pune fotografije.
- **Latinica i ćirilica** rade obe. Dijakritika nije bitna ('frizider' ≡ 'frižider').

## Razvoj

```bash
pnpm dev:stdio          # tsx, bez rebuild loop-a
pnpm dev:http
pnpm typecheck
pnpm inspect            # MCP Inspector na buildovani dist/stdio.js
```

## Arhitektura

- TypeScript, strict mode, bez `any`, bez `as` cast-ova osim na sistemskim granicama
- Native `fetch`, regex parsing __NEXT_DATA__-a (bez JSDOM-a — radi na Node-u, edge-u, Workers-ima)
- In-memory cookie jar za stabilnost sesije ka KP-u
- Slike inline-ovane kao `data:` URL-ovi (CSP fallback za hostove koji ne poštuju `csp.resourceDomains`)
- Production deploy: Raspberry Pi 5 + Coolify + Cloudflare Tunnel; auto-deploy na push preko GitHub Actions

## Licenca

MIT

---

# English

MCP (Model Context Protocol) server for [kupujemprodajem.com](https://www.kupujemprodajem.com) — Serbia's largest classifieds marketplace. Lets any MCP-compatible AI assistant (Claude, ChatGPT, Cursor, Continue, Cline, Windsurf, Zed, etc.) search KP listings and read full ad details.

## What it provides

Three tools, all behind one MCP endpoint:

| Tool | What it does |
|---|---|
| `list_kp_categories` | KP taxonomy lookup — **always call first** to get the right `categoryId` / `groupId`. 88 categories, ~1170 groups, baked in. |
| `search_kp` | Listing search with filters: price (EUR/RSD), condition, ordering, pagination, scope (title/description). |
| `fetch_listing` | Full detail for one ad: description, all photos, seller profile (reviews, verification), category-specific fields (cars: year/km/fuel, real estate: location, etc). |

Both rendering tools serve interactive UI widgets in hosts that implement the MCP Apps spec (Claude Desktop, claude.ai, etc.); otherwise they degrade gracefully to plain text.

## Install — remote (recommended)

Easiest path — use the public endpoint hosted on a Raspberry Pi with a residential Serbian IP (KP serves a stripped anti-bot page to datacenter IPs but full data to residential):

**`https://kp.osrc.io/mcp`**

Add as a "Custom Connector" in your AI host (claude.ai → Settings → Connectors, Cursor → MCP Servers, etc.). No auth.

## Install — local stdio

For full control / offline use / your own IP:

```bash
git clone https://github.com/OpenSource03/kp-mcp.git
cd kp-mcp
pnpm install
pnpm build
```

Register with Claude Code (project-scoped `.mcp.json`):

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

Same block format works for Claude Desktop's `claude_desktop_config.json`. For other MCP clients — anything that can spawn `node dist/stdio.js` and talk over stdin/stdout works.

## Install — remote self-hosted HTTP

```bash
PORT=3000 pnpm start:http
```

Endpoint: `POST/GET/DELETE http://localhost:3000/mcp` (streamable HTTP). Health check at `/health`.

For public exposure use Cloudflare Tunnel (free, WebSocket-friendly out of the box) or any reverse proxy.

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
- Production deploy: Raspberry Pi 5 + Coolify + Cloudflare Tunnel; auto-deploys on push via GitHub Actions

## License

MIT
