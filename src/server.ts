import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { fetchListing, searchProducts, KP_CONDITIONS } from "./kp.js";
import type { KpProduct } from "./types.js";
import { WIDGET_URIS, widgets } from "./widgets.js";

const SearchInput = {
  query: z
    .string()
    .min(1)
    .describe(
      "Free-text search keywords. KP does AND-matching across all words, so " +
      "every keyword must appear in the listing. Prefer 2–3 specific words " +
      "(e.g. 'iphone 13', 'rtx 3090', 'volkswagen golf'). Avoid stacking many " +
      "brands or the search will return 0 — instead, run multiple narrower " +
      "searches and combine the results.",
    ),
  priceFrom: z.number().int().nonnegative().optional()
    .describe("Minimum price (inclusive). Pair with `currency` so KP knows the unit."),
  priceTo: z.number().int().positive().optional()
    .describe("Maximum price (inclusive). Pair with `currency`."),
  currency: z.enum(["eur", "rsd"]).optional()
    .describe("Currency the price filters are in. KP supports EUR or RSD."),
  condition: z.array(z.enum(KP_CONDITIONS)).optional()
    .describe("Filter by item condition. Multiple values are OR-combined."),
  categoryId: z.number().int().positive().optional()
    .describe(
      "KP category ID. **Avoid passing this unless you have a verified ID** — " +
      "KP returns 0 results for nonexistent IDs and the IDs aren't intuitive " +
      "(e.g. graphics cards live under group 102, but the *category* is 10). " +
      "Filter by keyword instead in almost all cases.",
    ),
  orderBy: z
    .enum(["price", "price desc", "posted desc", "view_count desc", "relevance"])
    .optional()
    .describe(
      "Sort order. 'relevance' is the KP default; 'price' is ascending.",
    ),
  page: z.number().int().positive().optional()
    .describe("1-based page number. KP returns ~25 results per page."),
  limit: z.number().int().positive().max(30).optional()
    .describe(
      "Cap on returned products (default 10). Each result inlines a thumbnail " +
      "as a data URL, so very large limits can blow the host's tool-result size " +
      "budget. Stay ≤15 for embedded widgets; raise only if you don't need the cards.",
    ),
};

const FetchListingInput = {
  url: z
    .string()
    .url()
    .refine((u) => u.includes("kupujemprodajem.com"), {
      message: "URL must be a kupujemprodajem.com listing",
    })
    .describe("Full URL to a single KP ad page."),
};

// CSP allowlist for hosts that honor it (Claude Desktop). claude.ai web
// applies its own stricter `img-src 'self' data: blob:` regardless, so we also
// pre-inline images as data: URLs server-side — works in both worlds.
const KP_RESOURCE_DOMAINS = ["https://images.kupujemprodajem.com"];

function summarizeSearch(products: KpProduct[], searchUrl: string): string {
  if (products.length === 0) {
    return `No products found.\nSearch URL: ${searchUrl}`;
  }
  const lines = products.map(
    (p, i) =>
      `${i + 1}. ${p.name} — ${p.priceText || "(no price)"} — ${p.location}\n   ${p.adUrl}`,
  );
  return `${products.length} result(s):\n\n${lines.join("\n")}\n\nSearch URL: ${searchUrl}`;
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "kp-mcp", version: "0.1.0" },
    {
      instructions:
        "Search and inspect listings on kupujemprodajem.com (KP), the largest Serbian classifieds site. " +
        "Use `search_kp` first with relevant filters, then `fetch_listing` on a specific adUrl when more detail is needed. " +
        "Both tools render interactive UI widgets in hosts that support MCP Apps; results also include plain text so reasoning works in any host.",
    },
  );

  registerAppTool(
    server,
    "search_kp",
    {
      title: "Search KP",
      description:
        "Search kupujemprodajem.com for product listings. Renders an interactive grid " +
        "of result cards (image, price, location, seller). Use filters to narrow down. " +
        "Follow up with `fetch_listing` for full description, photos, and seller " +
        "details on a specific ad.",
      annotations: { title: "Search KP", readOnlyHint: true, openWorldHint: true },
      inputSchema: SearchInput,
      _meta: { ui: { resourceUri: WIDGET_URIS.search } },
    },
    async (args) => {
      const limit = args.limit ?? 10;
      const { query, priceFrom, priceTo, currency, condition, categoryId, orderBy, page } = args;
      const { products, searchUrl } = await searchProducts({
        query,
        priceFrom,
        priceTo,
        currency,
        condition,
        categoryId,
        orderBy,
        page,
      });
      const sliced = products.slice(0, limit);
      const payload = {
        searchUrl,
        totalReturned: sliced.length,
        truncated: products.length > sliced.length,
        products: sliced,
      };
      // Only the human-readable text in `content`; the widget reads
      // `structuredContent` directly. Avoiding a duplicate JSON dump keeps the
      // tool result well under claude.ai's per-call size cap.
      return {
        content: [{ type: "text", text: summarizeSearch(sliced, searchUrl) }],
        structuredContent: payload,
      };
    },
  );

  registerAppResource(
    server,
    "KP Search Results",
    WIDGET_URIS.search,
    {
      description: "Interactive grid of KP search results with thumbnails and actions.",
      _meta: {
        ui: {
          csp: { resourceDomains: KP_RESOURCE_DOMAINS },
          prefersBorder: false,
        },
      },
    },
    async () => ({
      contents: [
        {
          uri: WIDGET_URIS.search,
          mimeType: RESOURCE_MIME_TYPE,
          text: widgets.search,
        },
      ],
    }),
  );

  registerAppTool(
    server,
    "fetch_listing",
    {
      title: "Fetch KP Listing",
      description:
        "Fetch full detail for a single KP listing by URL. Renders an interactive " +
        "card with photo carousel, full description, complete seller profile " +
        "(reviews, verification), and category-specific fields (e.g. car " +
        "year/km/fuel type).",
      annotations: { title: "Fetch KP Listing", readOnlyHint: true, openWorldHint: true },
      inputSchema: FetchListingInput,
      _meta: { ui: { resourceUri: WIDGET_URIS.listing } },
    },
    async ({ url }) => {
      const listing = await fetchListing(url);
      const text =
        `${listing.name}\n` +
        `Price: ${listing.priceText || "(none)"}\n` +
        `Location: ${listing.location}\n` +
        `Posted: ${listing.postedDesc || listing.posted}\n` +
        `Seller: ${listing.user.username} (+${listing.user.reviewsPositive}/-${listing.user.reviewsNegative})\n` +
        `URL: ${listing.adUrl}\n\n` +
        `${listing.description}`;
      // Single text content — widget consumes structuredContent.
      return {
        content: [{ type: "text", text }],
        structuredContent: { listing },
      };
    },
  );

  registerAppResource(
    server,
    "KP Listing Detail",
    WIDGET_URIS.listing,
    {
      description: "Interactive detail view for a single KP listing.",
      _meta: {
        ui: {
          csp: { resourceDomains: KP_RESOURCE_DOMAINS },
          prefersBorder: false,
        },
      },
    },
    async () => ({
      contents: [
        {
          uri: WIDGET_URIS.listing,
          mimeType: RESOURCE_MIME_TYPE,
          text: widgets.listing,
        },
      ],
    }),
  );

  return server;
}
