#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { createServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 3000);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "*";

const app = express();
app.use(express.json({ limit: "4mb" }));

// Minimal CORS: needed when Claude.ai (or another web host) calls this server.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Mcp-Session-Id, Last-Event-ID, Authorization",
  );
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, name: "kp-mcp", transport: "streamable-http" });
});

// Diagnostic: probe KP from the container and return what it sees.
// Helps debug the cold-start / anti-bot situation without redeploying.
app.get("/debug/kp", async (_req, res) => {
  try {
    const url = "https://www.kupujemprodajem.com/pretraga?keywords=iphone+13";
    const r = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.7",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Upgrade-Insecure-Requests": "1",
      },
    });
    const html = await r.text();
    const m = html.match(/<script[^>]*\bid="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    let byIdCount = -1;
    let total: unknown = "n/a";
    let topPropKeys: string[] = [];
    if (m) {
      try {
        const data = JSON.parse(m[1]!);
        topPropKeys = Object.keys(data.props ?? {});
        const search = data.props?.initialReduxState?.search ?? {};
        byIdCount = Object.keys(search.byId ?? {}).length;
        total = search.total;
      } catch (e) {
        topPropKeys = [`parse error: ${String(e)}`];
      }
    }
    const setCookies = (r.headers as Headers & { getSetCookie?: () => string[] })
      .getSetCookie?.call(r.headers) ?? [];
    res.json({
      status: r.status,
      htmlLen: html.length,
      hasNextData: !!m,
      topPropKeys,
      byIdCount,
      total,
      setCookies: setCookies.map((c) => c.split(";")[0]),
      first300: html.slice(0, 300),
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// One transport per session, keyed by Mcp-Session-Id. Each session gets its own
// MCP server instance — that mirrors the SDK's recommended multi-tenant pattern
// for streamable-HTTP and keeps per-session state isolated.
const transports: Map<string, StreamableHTTPServerTransport> = new Map();

async function handleMcpPost(req: Request, res: Response): Promise<void> {
  const sessionId = req.header("mcp-session-id");
  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    if (!isInitializeRequest(req.body)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Missing or unknown Mcp-Session-Id; first call must be initialize." },
        id: null,
      });
      return;
    }

    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id: string) => {
        if (transport) transports.set(id, transport);
      },
    });

    transport.onclose = () => {
      if (transport?.sessionId) transports.delete(transport.sessionId);
    };

    const server = createServer();
    await server.connect(transport);
  }

  await transport.handleRequest(req, res, req.body);
}

async function handleMcpStream(req: Request, res: Response): Promise<void> {
  const sessionId = req.header("mcp-session-id");
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send("Missing or unknown Mcp-Session-Id");
    return;
  }
  await transport.handleRequest(req, res);
}

app.post("/mcp", (req, res) => {
  handleMcpPost(req, res).catch((err) => {
    process.stderr.write(`kp-mcp: POST /mcp error: ${err}\n`);
    if (!res.headersSent) res.status(500).json({ error: "internal error" });
  });
});

app.get("/mcp", (req, res) => {
  handleMcpStream(req, res).catch((err) => {
    process.stderr.write(`kp-mcp: GET /mcp error: ${err}\n`);
    if (!res.headersSent) res.status(500).end();
  });
});

app.delete("/mcp", (req, res) => {
  handleMcpStream(req, res).catch((err) => {
    process.stderr.write(`kp-mcp: DELETE /mcp error: ${err}\n`);
    if (!res.headersSent) res.status(500).end();
  });
});

app.listen(PORT, () => {
  process.stderr.write(`kp-mcp: streamable-HTTP listening on :${PORT}/mcp\n`);
});
