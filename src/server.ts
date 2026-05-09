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
      "Search keywords. KP does AND-matching across every word, so every " +
      "keyword must appear in the listing — extra words almost always shrink " +
      "the result set. Follow these rules:\n" +
      "\n" +
      "• **Don't pad with category nouns.** Model codes are unique. Use " +
      "  'RTX 3090' (not 'RTX 3090 graficka karta'), 'iPhone 13' (not " +
      "  'iPhone 13 telefon'), 'Passat B8' (not 'Passat B8 auto'), " +
      "  'frižider' (not 'kućni frižider aparat').\n" +
      "• **Add manufacturer only if the user asked for one specifically.** " +
      "  Don't guess 'ASUS RTX 3090' if the user just said 'RTX 3090'.\n" +
      "• **Don't put years, storage sizes, or detailed specs in the query.** " +
      "  Few sellers literally write '2018' or '256GB' in the title. Use " +
      "  price filters to narrow, then `fetch_listing` to verify specs.\n" +
      "• **Prefer Serbian for everyday items**: real estate ('stan', 'kuća'), " +
      "  appliances ('frižider', 'mašina za veš', 'usisivač'), clothing " +
      "  ('jakna', 'patike'). English works for branded electronics/cars.\n" +
      "• **Diacritics don't matter** — 'frižider' and 'frizider' return the " +
      "  same results.\n" +
      "• **2–3 words is the sweet spot.** If a search returns 0, *remove* " +
      "  words rather than add them.",
    ),
  priceFrom: z.number().int().nonnegative().optional()
    .describe(
      "Minimum price (inclusive). **Always pair with `currency`** or KP " +
      "interprets the number in RSD which can produce confusing results. " +
      "Especially important when using `orderBy: 'price'` — without a floor " +
      "you'll get 'Kupujem' (wanted-to-buy) ads, exchange listings, and " +
      "small parts/accessories at the top.",
    ),
  priceTo: z.number().int().positive().optional()
    .describe("Maximum price (inclusive). Pair with `currency`."),
  currency: z.enum(["eur", "rsd"]).optional()
    .describe(
      "Currency for price filters. KP supports EUR or RSD. Listings on KP " +
      "are priced in either, often mixed within one search — set this so " +
      "the price filter applies in the unit you mean.",
    ),
  condition: z.array(z.enum(KP_CONDITIONS)).optional()
    .describe(
      "Filter by item condition. OR-combined. Useful for 'only new' searches " +
      "(`['new', 'as-new']`) or 'damaged only' (`['damaged']`). Skip when a " +
      "price filter is already narrowing the result enough.",
    ),
  categoryId: z.number().int().positive().optional()
    .describe(
      "KP category ID. **Almost always omit this.** KP returns 0 results for " +
      "nonexistent IDs and the numbering isn't intuitive (graphics cards live " +
      "under group 102 but the *category* is 10, etc.). Keyword filtering is " +
      "more reliable.",
    ),
  orderBy: z
    .enum(["price", "price desc", "posted desc", "view_count desc", "relevance"])
    .optional()
    .describe(
      "Sort order:\n" +
      "• `relevance` (KP default) — best for exploration\n" +
      "• `price` — ascending. **Pair with `priceFrom`** or you'll get junk\n" +
      "  (parts, exchange ads, 'Kupujem' wanted-to-buy ads) at the top\n" +
      "• `price desc` — most expensive first; useful for premium items\n" +
      "• `posted desc` — newest first; for fresh listings\n" +
      "• `view_count desc` — popular listings first",
    ),
  page: z.number().int().positive().optional()
    .describe(
      "1-based page (default 1). KP returns ~25 per page. Page 1 has the " +
      "freshest/best listings; deeper pages get stale fast.",
    ),
  keywordsScope: z.enum(["title", "description"]).optional()
    .describe(
      "Where keywords match. 'title' (default) is precise and fast. Use " +
      "'description' as a **fallback when a title-only search returns 0** " +
      "for a query that plausibly should match — KP sellers often bundle " +
      "many brand names or model codes in the listing body. Don't use it " +
      "by default — title matches are higher quality.",
    ),
  limit: z.number().int().positive().max(30).optional()
    .describe(
      "Number of results (default 10, max 30). Each result inlines a " +
      "thumbnail, so very large limits can blow the host's tool-result " +
      "size cap. 10 is fine for picking; raise to 20 only when comparing.",
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
        "Search and inspect listings on kupujemprodajem.com (KP), Serbia's largest classifieds.\n" +
        "\n" +
        "## Workflow\n" +
        "1. **Search broadly first.** Start with the most distinctive 1–3 words " +
        "  (model code, brand+model, key Serbian noun). Don't pad with category " +
        "  words — 'RTX 3090', not 'RTX 3090 graficka karta'.\n" +
        "2. **Add filters second.** If you get junk (parts, accessories, " +
        "  'Kupujem' wanted-to-buy ads): add `priceFrom` + `currency`. If you " +
        "  get too many results: add `priceTo` or `condition`.\n" +
        "3. **Sort thoughtfully.** Default `relevance` is best for browsing. " +
        "  `price` ascending is great for hunting deals BUT requires a " +
        "  `priceFrom` floor or you'll get 27€ water blocks at the top of " +
        "  a GPU search.\n" +
        "4. **`fetch_listing` is preferred** whenever the user cares about " +
        "  specifics not visible in search cards: full description, all photos, " +
        "  seller reputation/verification, exact storage/year/km/fuel for cars, " +
        "  delivery options. Always fetch before recommending a listing as 'the " +
        "  best deal'.\n" +
        "5. **If a title-only search returns 0**, retry with " +
        "  `keywordsScope: 'description'` once — many sellers bundle multiple " +
        "  model names in the listing body.\n" +
        "\n" +
        "## What KP returns vs. doesn't\n" +
        "- Search results carry: title, price, location, image, posted date, " +
        "  view count, condition, category. **No seller info** in search hits — " +
        "  use `fetch_listing` for username/reviews/verification.\n" +
        "- Prices come in EUR or RSD; both can appear in the same result set. " +
        "  Always set `currency` when filtering by price.\n" +
        "- 'Kupujem' priceText means 'I'm buying this' (wanted-to-buy ad) — " +
        "  filter these out via `priceFrom`.\n" +
        "\n" +
        "Both tools render interactive UI in hosts that support MCP Apps " +
        "(claude.ai, Claude Desktop) and degrade to plain text elsewhere.",
    },
  );

  registerAppTool(
    server,
    "search_kp",
    {
      title: "Search KP",
      description:
        "Search kupujemprodajem.com (KP), Serbia's largest classifieds. Returns " +
        "a list of listings with price, location, thumbnail, and ad URL.\n" +
        "\n" +
        "**Query rules** (read these — bad queries are the #1 cause of empty results):\n" +
        "• Use the most distinctive 1–3 words. Model codes and brand+model are " +
        "  unique enough on KP — DO NOT pad with category nouns:\n" +
        "    ✓ 'RTX 3090'           ✗ 'RTX 3090 graficka karta'\n" +
        "    ✓ 'iPhone 13'          ✗ 'iPhone 13 telefon'\n" +
        "    ✓ 'Passat B8'          ✗ 'Passat B8 auto polovni'\n" +
        "    ✓ 'Ryzen 7 5800X'      ✗ 'AMD Ryzen 7 5800X procesor'\n" +
        "    ✓ 'frižider'           ✗ 'kućni frižider aparat'\n" +
        "• Add manufacturer ONLY when the user specified one. Don't guess " +
        "  'ASUS RTX 3090' if the user just said 'RTX 3090'.\n" +
        "• Don't include years, storage sizes, or detailed specs in the query " +
        "  ('BMW 320d 2018' returns 0; 'BMW 320d' returns real cars). Use " +
        "  price filters to narrow and `fetch_listing` to verify.\n" +
        "• Prefer Serbian for everyday items (real estate, appliances, clothes). " +
        "  English fine for branded electronics/cars. Diacritics are optional.\n" +
        "• If you get 0 results, *remove* a word — never add more.\n" +
        "\n" +
        "**Filter rules:**\n" +
        "• Always pair `priceFrom`/`priceTo` with `currency` ('eur' or 'rsd').\n" +
        "• When using `orderBy: 'price'`, set `priceFrom` or you'll get " +
        "  parts/exchange/wanted-to-buy ads at the top.\n" +
        "• Skip `categoryId` — KP's IDs aren't intuitive and wrong values " +
        "  return 0.\n" +
        "\n" +
        "**Empty-result fallbacks** (try in order):\n" +
        "1. Drop padding words from the query.\n" +
        "2. Re-run with `keywordsScope: 'description'`.\n" +
        "3. Try the Serbian or English equivalent of the noun.\n" +
        "\n" +
        "Renders an interactive card grid in hosts that support MCP Apps. " +
        "Search results don't carry seller info — call `fetch_listing` for that.",
      annotations: { title: "Search KP", readOnlyHint: true, openWorldHint: true },
      inputSchema: SearchInput,
      _meta: { ui: { resourceUri: WIDGET_URIS.search } },
    },
    async (args) => {
      const limit = args.limit ?? 10;
      const { query, priceFrom, priceTo, currency, condition, categoryId, orderBy, page, keywordsScope } = args;
      const { products, searchUrl } = await searchProducts({
        query,
        priceFrom,
        priceTo,
        currency,
        condition,
        categoryId,
        orderBy,
        page,
        keywordsScope,
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
        "Fetch full detail for a single KP listing by URL. Returns the data " +
        "that search results don't carry: full description, all photos, " +
        "complete seller profile (username, +X/-Y reviews, verified-bank " +
        "badge, member-since date, active ad count), and category-specific " +
        "fields (cars: year/km/fuel/cc, real estate: location detail, " +
        "appliances: condition specifics).\n" +
        "\n" +
        "**Strongly preferred whenever the user cares about specifics** — " +
        "use it before recommending any listing as 'the best deal' or " +
        "'the cheapest', and any time the user asks about:\n" +
        "• Storage / RAM / CPU spec on a phone/laptop\n" +
        "• Year / km / fuel / engine size on a car\n" +
        "• Seller reputation or verification\n" +
        "• Whether an item is genuinely sold or just 'wanted to buy'\n" +
        "• Photos beyond the search thumbnail\n" +
        "• Delivery / pickup options\n" +
        "\n" +
        "Renders an interactive card with photo carousel and full detail. " +
        "Cheap to call (~300 ms warm).",
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
