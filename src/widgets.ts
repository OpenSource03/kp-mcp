import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

/**
 * The iframe sandbox enforced by Claude blocks CDN script fetches, so the
 * `@modelcontextprotocol/ext-apps` browser bundle must be inlined into every
 * widget HTML. The package ships an ESM bundle whose final line is
 * `export { ... };` — we rewrite that to `globalThis.ExtApps = { ... };` so it
 * runs as a classic script and the widget can read `globalThis.ExtApps.App`.
 */
function loadExtAppsBundle(): string {
  const raw = readFileSync(
    require.resolve("@modelcontextprotocol/ext-apps/app-with-deps"),
    "utf8",
  );
  return raw.replace(/export\{([^}]+)\};?\s*$/, (_, body: string) => {
    const pairs = body.split(",").map((part) => {
      const [local, exported] = part.split(" as ").map((s) => s.trim());
      return `${exported ?? local}:${local}`;
    });
    return `globalThis.ExtApps={${pairs.join(",")}};`;
  });
}

const BUNDLE = loadExtAppsBundle();

const __dirname = dirname(fileURLToPath(import.meta.url));
// `widgets/` sits at the package root, one level above `dist/` (or `src/` in dev).
const widgetsDir = join(__dirname, "..", "widgets");

function inline(htmlFile: string): string {
  const html = readFileSync(join(widgetsDir, htmlFile), "utf8");
  return html.replace("/*__EXT_APPS_BUNDLE__*/", () => BUNDLE);
}

/** Inlined widget HTML strings, ready to serve as MCP UI resources. */
export const widgets = {
  search: inline("search.html"),
  listing: inline("listing.html"),
} as const;

export const WIDGET_URIS = {
  search: "ui://kp/search.html",
  listing: "ui://kp/listing.html",
} as const;
