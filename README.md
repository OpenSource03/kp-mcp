# kp-mcp

🇷🇸 **Srpski** · [🇬🇧 English](README.en.md)

[![Deploy](https://github.com/OpenSource03/kp-mcp/actions/workflows/deploy.yml/badge.svg)](https://github.com/OpenSource03/kp-mcp/actions/workflows/deploy.yml)
[![npm version](https://img.shields.io/npm/v/@opensource03/kp-mcp?color=cb3837&logo=npm)](https://www.npmjs.com/package/@opensource03/kp-mcp)
[![npm downloads](https://img.shields.io/npm/dm/@opensource03/kp-mcp?color=cb3837)](https://www.npmjs.com/package/@opensource03/kp-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-7c3aed)](https://modelcontextprotocol.io)

MCP (Model Context Protocol) server za [kupujemprodajem.com](https://www.kupujemprodajem.com) — najveći oglasnik u Srbiji. Omogućava bilo kom AI asistentu koji podržava MCP (Claude, ChatGPT, Cursor, Continue, Cline, Windsurf, Zed i drugi) da pretražuje KP oglase i čita pune detalje pojedinačnih oglasa.

## Šta nudi

Tri alata, sve dostupno preko jednog MCP endpoint-a:

| Alat | Šta radi |
|---|---|
| `list_kp_categories` | Pretraga taksonomije KP-a — **uvek prvo pozvati** za pravi `categoryId` / `groupId`. 88 kategorija, ~1170 grupa, ugrađeno u server. |
| `search_kp` | Pretraga oglasa sa filterima: cena (EUR/RSD), stanje, sortiranje, paginacija, scope (title/description). |
| `fetch_listing` | Pun detalj jednog oglasa: opis, sve fotografije, profil prodavca (recenzije, verifikacija), specifikacije za auto / nekretnine. |

Svi alati renderuju interaktivne UI widgete u host-ovima koji podržavaju MCP Apps spec (Claude Desktop, claude.ai i drugi); inače padaju nazad na čist tekst.

## Korišćenje — preko hostovanog endpointa (preporučeno)

Najlakši način — koristi javni endpoint koji se hostuje na infrastrukturi sa srpskom IP adresom (KP servira drastično bolje rezultate domaćim IP-jevima):

**`https://kp.osrc.io/mcp`**

Dodaj kao "Custom Connector" u svoj AI host (claude.ai → Settings → Connectors, Cursor → MCP Servers, itd.). Bez autorizacije.

## Lokalno (npx, bez instalacije)

Najlakša lokalna varijanta — bez kloniranja, bez build-a. Treba samo Node 20+:

```jsonc
// .mcp.json (Claude Code) ili claude_desktop_config.json
{
  "mcpServers": {
    "kp": {
      "command": "npx",
      "args": ["-y", "@opensource03/kp-mcp"]
    }
  }
}
```

Za Cursor / Continue / Cline / Windsurf / Zed i druge — isti format, samo u njihovom MCP config fajlu. Prvi put `npx` skida paket iz npm-a (~5 sec); kasnije se keširano pokreće.

Direktno iz terminala (za testiranje):
```bash
npx -y @opensource03/kp-mcp           # stdio mode
PORT=3000 npx -y -p @opensource03/kp-mcp kp-mcp-http   # HTTP mode na portu 3000
```

## Lokalno (iz git source-a)

Ako želiš da modifikuješ kod:

```bash
git clone https://github.com/OpenSource03/kp-mcp.git
cd kp-mcp && pnpm install && pnpm build
```

Registracija — koristi apsolutni path do `dist/stdio.js`:

```jsonc
{ "mcpServers": { "kp": { "command": "node", "args": ["/absolute/path/to/kp-mcp/dist/stdio.js"] } } }
```

## Self-hosted preko HTTP-a

```bash
PORT=3000 pnpm start:http
```

Endpoint: `POST/GET/DELETE http://localhost:3000/mcp` (streamable HTTP). Health check na `/health`.

Za javnu izloženost koristi bilo koji reverse proxy ili tunel.

## Saveti za korišćenje

KP-ova pretraga ima nekoliko specifičnosti — alati su podešeni da modeli prave dobre zahteve, ali evo šta treba znati:

- **Uvek koristi `list_kp_categories` prvo** — drastično poboljšava kvalitet rezultata. Inače "RTX 3090" sortiran po ceni vraća vodene blokove od 27€.
- **Ne dodaji "graficka karta", "telefon", "auto"** u pretragu. Modeli kodovi su jedinstveni: 'RTX 3090' radi, 'RTX 3090 graficka karta' vraća 0.
- **Pratiti `priceFrom` sa `currency`**. KP servira oglase i u EUR i u RSD u istoj listi.
- **`fetch_listing`** je praktično obavezan pre nego što preporučiš oglas — search rezultati ne sadrže recenzije prodavca, godišta auta, ili pune fotografije.
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
- Native `fetch`, regex parsing `__NEXT_DATA__`-a (bez JSDOM-a — radi na Node-u, edge-u, Workers-ima)
- In-memory cookie jar za stabilnost sesije ka KP-u
- Slike inline-ovane kao `data:` URL-ovi (CSP fallback za hostove koji ne poštuju `csp.resourceDomains`)

## Licenca

MIT
