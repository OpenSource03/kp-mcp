#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is fine for logs over stdio; stdout is reserved for the protocol.
  process.stderr.write("kp-mcp: stdio transport connected\n");
}

main().catch((err) => {
  process.stderr.write(`kp-mcp: fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
