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
import { CATEGORY_TREE, categoryById } from "./categories.js";

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
      "Top-level KP category ID (e.g. 10 = 'Kompjuteri | Desktop', 2013 = " +
      "'Automobili'). Use this to scope a search to a broad category. Always " +
      "use a verified ID — wrong IDs return 0. Run `list_kp_categories` first " +
      "if you don't know the ID.",
    ),
  groupId: z.number().int().positive().optional()
    .describe(
      "Subcategory / group ID inside a category (e.g. 102 = 'Grafičke kartice' " +
      "inside category 10). Group alone is sufficient — you don't need to set " +
      "categoryId too. Use this to narrow a search precisely (e.g. iPhones " +
      "only, not all phones). Verify the ID via `list_kp_categories`.",
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
        "## Tools\n" +
        "- `list_kp_categories` — taxonomy lookup for `categoryId`/`groupId`.\n" +
        "- `search_kp` — keyword + filter search, returns up to ~30 listings.\n" +
        "- `fetch_listing` — full detail for one ad (specs, photos, seller).\n" +
        "\n" +
        "## ⚠️ MANDATORY FIRST STEP for any product search\n" +
        "\n" +
        "**ALWAYS call `list_kp_categories` BEFORE `search_kp`** for ANY of " +
        "these intents (which is essentially every real product query):\n" +
        "\n" +
        "  • Vehicles (cars, motorcycles, bicycles)\n" +
        "  • Phones, laptops, tablets, computer parts (GPU/CPU/RAM/SSD)\n" +
        "  • TVs, monitors, audio gear, gaming consoles\n" +
        "  • Real estate (apartments, houses, plots)\n" +
        "  • Appliances (fridges, washers, dishwashers, AC)\n" +
        "  • Fashion (clothing, shoes, watches, bags)\n" +
        "  • Sports gear, instruments, books, baby gear, furniture\n" +
        "  • Anything else that has a clear KP category\n" +
        "\n" +
        "**Why this is required, not optional:** keyword-only `search_kp` " +
        "consistently returns parts, accessories, 'Kupujem' wanted-to-buy ads, " +
        "and unrelated junk at the top of price-sorted results. A `groupId` " +
        "(e.g. 102 = 'Grafičke kartice', 489 = 'Apple iPhone', 152 = " +
        "'Oldtajmeri') eliminates ~90% of that junk in one parameter.\n" +
        "\n" +
        "**Calling pattern:**\n" +
        "```\n" +
        "// Step 1 — find the right group:\n" +
        "list_kp_categories({ search: \"<category word, English or Serbian>\" })\n" +
        "// → returns matching categories + groups; pick the most specific groupId\n" +
        "\n" +
        "// Step 2 — search WITH that groupId:\n" +
        "search_kp({ query: \"<distinctive keywords>\", groupId: <chosen id>, ... })\n" +
        "```\n" +
        "\n" +
        "Skip `list_kp_categories` only for: meta-queries about KP itself, when " +
        "the user pasted a specific listing URL (use `fetch_listing` directly), " +
        "or when you're doing a 2nd refinement search on already-narrowed results.\n" +
        "\n" +
        "## Query rules for `search_kp`\n" +
        "1. **Keep query to 1–3 distinctive words.** Model codes are unique " +
        "  on KP — 'RTX 3090', not 'RTX 3090 graficka karta'. Don't pad with " +
        "  category nouns ('telefon', 'auto', 'aparat'). If you scoped by " +
        "  `groupId`, the category is already implied — make the query even " +
        "  shorter.\n" +
        "2. **Don't add manufacturer unless the user asked.**\n" +
        "3. **No years, storage sizes, or specs in query.** Few sellers write " +
        "  '2018' or '256GB' in the title — verify these via `fetch_listing`.\n" +
        "4. **Always pair `priceFrom`/`priceTo` with `currency`** ('eur' or 'rsd').\n" +
        "5. **`orderBy: 'price'` requires a `priceFrom` floor OR a `groupId`** " +
        "  — otherwise water blocks rank #1 in any GPU search.\n" +
        "6. **0 results → drop a word** from the query, then try " +
        "  `keywordsScope: 'description'`. Never add more words.\n" +
        "7. **Diacritics don't matter.** 'frizider' ≡ 'frižider'.\n" +
        "\n" +
        "## When to call `fetch_listing` (preferred path)\n" +
        "Whenever the user cares about specifics not in search cards:\n" +
        "  • Storage / RAM / CPU on phones/laptops\n" +
        "  • Year / km / fuel / engine size on cars\n" +
        "  • Seller reputation, reviews, verification\n" +
        "  • Whether ad is real-sale vs 'Kupujem' (wanted-to-buy)\n" +
        "  • Photos beyond the search thumbnail\n" +
        "  • Delivery / pickup options\n" +
        "Always fetch before recommending any listing as 'the best deal'.\n" +
        "\n" +
        "## Data shape notes\n" +
        "- Search hits carry title, price, location, image, posted date, view " +
        "  count, condition, category/group. No seller info — that's " +
        "  `fetch_listing` only.\n" +
        "- Prices mix EUR + RSD in one result set. Always set `currency` " +
        "  when filtering.\n" +
        "- 'Kupujem' priceText = wanted-to-buy ad. Filter out via `priceFrom` " +
        "  or scope by `groupId`.\n" +
        "\n" +
        "All tools render interactive UI in hosts that support MCP Apps.",
    },
  );

  registerAppTool(
    server,
    "search_kp",
    {
      title: "Search KP",
      description:
        "Search kupujemprodajem.com (KP), Serbia's largest classifieds.\n" +
        "\n" +
        "## ⚠️ MANDATORY: call `list_kp_categories` FIRST\n" +
        "\n" +
        "Before calling `search_kp` for any real product query (cars, phones, " +
        "GPUs, real estate, appliances, fashion, etc.), **first call** " +
        "`list_kp_categories({ search: '<category-word>' })` to find the right " +
        "`groupId`, then pass that `groupId` here. Without it, price-sorted " +
        "GPU searches return 27€ water blocks at the top, phone searches " +
        "return cases and chargers, etc. Skip this step ONLY for refinement " +
        "passes on already-narrowed results.\n" +
        "\n" +
        "**Correct calling pattern:**\n" +
        "```\n" +
        "// 1. Find the group:\n" +
        "list_kp_categories({ search: 'graphics' })\n" +
        "// → groupId 102 = 'Grafičke kartice'\n" +
        "\n" +
        "// 2. Then search:\n" +
        "search_kp({ query: 'RTX 3090', groupId: 102, orderBy: 'price', limit: 10 })\n" +
        "```\n" +
        "\n" +
        "## Query rules\n" +
        "Bad queries are the #1 cause of empty/junk results.\n" +
        "\n" +
        "• **Keep `query` to 1–3 distinctive words.** Model codes are unique " +
        "  on KP — DO NOT pad with category nouns:\n" +
        "    ✓ 'RTX 3090'           ✗ 'RTX 3090 graficka karta'\n" +
        "    ✓ 'iPhone 13'          ✗ 'iPhone 13 telefon'\n" +
        "    ✓ 'Passat B8'          ✗ 'Passat B8 auto polovni'\n" +
        "    ✓ 'Ryzen 7 5800X'      ✗ 'AMD Ryzen 7 5800X procesor'\n" +
        "    ✓ 'frižider'           ✗ 'kućni frižider aparat'\n" +
        "  When you've already scoped by `groupId`, make the query EVEN shorter.\n" +
        "• **Add manufacturer only when the user specified one.** Don't guess " +
        "  'ASUS RTX 3090' if the user just said 'RTX 3090'.\n" +
        "• **No years, storage sizes, or specs in `query`.** ('BMW 320d 2018' " +
        "  returns 0; 'BMW 320d' returns real cars.) Verify these via " +
        "  `fetch_listing`.\n" +
        "• **Prefer Serbian** for everyday items (real estate, appliances, " +
        "  clothes). English fine for branded electronics/cars. Diacritics " +
        "  are optional ('frizider' ≡ 'frižider').\n" +
        "• **If you get 0 results, REMOVE a word** — never add more.\n" +
        "\n" +
        "## Filter rules\n" +
        "• Always pair `priceFrom`/`priceTo` with `currency` ('eur' or 'rsd').\n" +
        "• `orderBy: 'price'` requires a `priceFrom` floor OR a `groupId` — " +
        "  otherwise water blocks/exchange/wanted-to-buy ads rank #1.\n" +
        "• `groupId` alone is sufficient — you don't need to set `categoryId`.\n" +
        "\n" +
        "## Empty-result fallbacks (try in order)\n" +
        "1. Drop a word from `query`.\n" +
        "2. Re-run with `keywordsScope: 'description'`.\n" +
        "3. Try the Serbian or English equivalent of the noun.\n" +
        "\n" +
        "Renders an interactive card grid. Search results don't carry seller " +
        "info — call `fetch_listing` for username/reviews/verification.",
      annotations: { title: "Search KP", readOnlyHint: true, openWorldHint: true },
      inputSchema: SearchInput,
      _meta: { ui: { resourceUri: WIDGET_URIS.search } },
    },
    async (args) => {
      const limit = args.limit ?? 10;
      const { query, priceFrom, priceTo, currency, condition, categoryId, groupId, orderBy, page, keywordsScope } = args;
      const { products, searchUrl } = await searchProducts({
        query,
        priceFrom,
        priceTo,
        currency,
        condition,
        categoryId,
        groupId,
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

  // -------- list_kp_categories --------
  server.registerTool(
    "list_kp_categories",
    {
      title: "List KP Categories",
      description:
        "Look up KP's category and group IDs. **Call this FIRST before " +
        "`search_kp`** for any real product query — it's the difference " +
        "between getting actual phones and getting phone cases at the top " +
        "of a price-sorted search.\n" +
        "\n" +
        "KP has 88 top-level categories and ~1170 groups underneath them.\n" +
        "\n" +
        "## Modes\n" +
        "• **`search: '<word>'`** (most common — use this) — diacritic- and " +
        "  case-insensitive substring match across all category and group " +
        "  names in Serbian and English. Returns matching categories AND " +
        "  groups so you can pick the most specific `groupId`.\n" +
        "• **`categoryId: <n>`** — drill into a category, list all its groups.\n" +
        "• **No args** — returns all 88 top-level categories with group counts.\n" +
        "\n" +
        "## Quick mapping cheat sheet (verified Sep 2026 — re-search if unsure)\n" +
        "  Cars              → categoryId 2013 (Automobili)\n" +
        "  Phones (all)      → categoryId 23   (Mobilni telefoni)\n" +
        "  iPhone only       → groupId    489  (Apple iPhone)\n" +
        "  Computer parts    → categoryId 10   (Kompjuteri | Desktop)\n" +
        "  GPU only          → groupId    102  (Grafičke kartice)\n" +
        "  Laptops/tablets   → categoryId 1221\n" +
        "  Appliances        → categoryId 15   (Bela tehnika i kućni aparati)\n" +
        "  Fridges only      → groupId    190  (Frižideri)\n" +
        "  Washing machines  → groupId    188  (Veš mašine)\n" +
        "  Dishwashers       → groupId    193  (Mašine za pranje sudova)\n" +
        "  Audio gear        → categoryId 1\n" +
        "  Headphones        → groupId    616  (Slušalice)\n" +
        "  Real estate sale  → categoryId 2821 (Nekretnine | Prodaja)\n" +
        "  Real estate rent  → categoryId 2850 (Nekretnine | Izdavanje)\n" +
        "  Motorcycles       → categoryId 21\n" +
        "  Men's shoes       → groupId    1078\n" +
        "  Women's shoes     → groupId    1077\n" +
        "  Watches           → groupId    464  (in Uređenje kuće)\n" +
        "\n" +
        "## When to skip\n" +
        "Only when the user explicitly wants a cross-category search, asks a " +
        "meta-question about KP itself, or you're refining an already-narrowed " +
        "search.",
      annotations: { title: "List KP Categories", readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        categoryId: z.number().int().positive().optional()
          .describe("Drill into a specific category and list its groups."),
        search: z.string().min(1).optional()
          .describe("Substring search across category and group names. Case-insensitive."),
      },
    },
    async ({ categoryId, search }) => {
      if (categoryId !== undefined) {
        const entry = categoryById(categoryId);
        if (!entry) {
          return {
            content: [{ type: "text", text: `No KP category with id ${categoryId}.` }],
            structuredContent: { categoryId, found: false },
          };
        }
        const groups = Object.entries(entry.groups).map(([id, name]) => ({
          id: Number(id),
          name,
        }));
        return {
          content: [{
            type: "text",
            text: `Category ${categoryId} "${entry.name}" — ${groups.length} groups:\n` +
              groups.map((g) => `  ${g.id}\t${g.name}`).join("\n"),
          }],
          structuredContent: {
            categoryId: Number(categoryId),
            name: entry.name,
            groups,
          },
        };
      }

      if (search) {
        // Diacritic-insensitive: "graficke" should match "Grafičke", etc.
        const fold = (s: string) =>
          s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
        const needle = fold(search);
        const matchedCats: { id: number; name: string }[] = [];
        const matchedGroups: { categoryId: number; categoryName: string; id: number; name: string }[] = [];
        for (const [cid, entry] of Object.entries(CATEGORY_TREE)) {
          if (fold(entry.name).includes(needle)) {
            matchedCats.push({ id: Number(cid), name: entry.name });
          }
          for (const [gid, gname] of Object.entries(entry.groups)) {
            if (fold(gname).includes(needle)) {
              matchedGroups.push({
                categoryId: Number(cid),
                categoryName: entry.name,
                id: Number(gid),
                name: gname,
              });
            }
          }
        }
        const lines: string[] = [];
        if (matchedCats.length) {
          lines.push("CATEGORIES:");
          for (const c of matchedCats) lines.push(`  ${c.id}\t${c.name}`);
        }
        if (matchedGroups.length) {
          lines.push("GROUPS:");
          for (const g of matchedGroups) {
            lines.push(`  groupId=${g.id}\t${g.name}  (in category ${g.categoryId} ${g.categoryName})`);
          }
        }
        if (!lines.length) lines.push(`No matches for "${search}".`);
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          structuredContent: {
            search,
            categories: matchedCats,
            groups: matchedGroups,
          },
        };
      }

      // No args: list all categories.
      const categories = Object.entries(CATEGORY_TREE).map(([id, entry]) => ({
        id: Number(id),
        name: entry.name,
        groupCount: Object.keys(entry.groups).length,
      }));
      return {
        content: [{
          type: "text",
          text: `${categories.length} KP categories:\n` +
            categories.map((c) => `  ${c.id}\t${c.name} (${c.groupCount} groups)`).join("\n"),
        }],
        structuredContent: { categories },
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
