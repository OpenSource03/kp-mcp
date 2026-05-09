import {
  KpCondition,
  KpListing,
  KpProduct,
  KpSearchParams,
  KpUser,
} from "./types.js";

const KP_ORIGIN = "https://www.kupujemprodajem.com";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
};

/** Build a KP search URL from structured params. */
export function buildSearchUrl(params: KpSearchParams): string {
  const url = new URL("/pretraga", KP_ORIGIN);
  const q = url.searchParams;

  q.set("keywords", params.query);
  if (params.priceFrom !== undefined) q.set("priceFrom", String(params.priceFrom));
  if (params.priceTo !== undefined) q.set("priceTo", String(params.priceTo));
  if (params.currency) q.set("currency", params.currency);
  if (params.condition) {
    for (const c of params.condition) q.append("condition", c);
  }
  if (params.categoryId !== undefined) q.set("categoryId", String(params.categoryId));
  if (params.orderBy) q.set("order", params.orderBy);
  if (params.page !== undefined) q.set("page", String(params.page));

  return url.toString();
}

/**
 * Process-wide cookie jar for kupujemprodajem.com.
 *
 * KP serves a *stripped* page (no `initialReduxState.search.byId`) on the very
 * first request from a fresh connection / datacenter IP, and only hydrates the
 * full server-rendered state once the request carries the `KUPUJEMPRODAJEM`
 * session cookie that the first response sets. From a residential IP this is
 * usually waived; from Railway's egress IP it bites every cold start.
 *
 * Keeping a shared jar across requests means:
 *   1. Once any user has triggered one search, every subsequent search reuses
 *      the warm cookie and gets full data on the first try.
 *   2. The retry below only kicks in for the very first cold call.
 */
const cookieJar = new Map<string, string>();

function cookieHeader(): string {
  return Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}

function ingestSetCookie(headers: Headers): void {
  const getter = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const all = typeof getter === "function" ? getter.call(headers) : [];
  for (const raw of all) {
    const [pair] = raw.split(";");
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    cookieJar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

/** Fetch HTML using browser-like headers + a shared KP cookie jar. */
export async function fetchHtml(url: string): Promise<string> {
  const headers: Record<string, string> = { ...BROWSER_HEADERS };
  const cookie = cookieHeader();
  if (cookie) headers["Cookie"] = cookie;
  const res = await fetch(url, { headers, redirect: "follow" });
  ingestSetCookie(res.headers);
  if (!res.ok) {
    throw new Error(`KP fetch failed: ${res.status} ${res.statusText} for ${url}`);
  }
  return await res.text();
}

/**
 * The KP site is Next.js-rendered; the entire page state is embedded as JSON
 * inside `<script id="__NEXT_DATA__" type="application/json">…</script>`. A
 * regex match is used instead of JSDOM so this code stays runtime-agnostic
 * (Node, Workers, edge) and avoids a 3 MB DOM dependency.
 */
// Tolerant of extra attributes (KP injects a CSP `nonce` after `type`).
const NEXT_DATA_RE =
  /<script[^>]*\bid="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;

interface UnknownRecord {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseNextData(html: string): UnknownRecord {
  const match = html.match(NEXT_DATA_RE);
  if (!match || !match[1]) {
    throw new Error("__NEXT_DATA__ script not found in KP HTML response");
  }
  const parsed: unknown = JSON.parse(match[1]);
  if (!isRecord(parsed)) {
    throw new Error("__NEXT_DATA__ JSON is not an object");
  }
  return parsed;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function bool(v: unknown): boolean {
  return v === true;
}

/**
 * Listing photos come as `{ original, thumbnail }` objects on detail pages and
 * as raw URL strings on search pages. Normalize both to a plain string array
 * (preferring `original` > `thumbnail` > raw string).
 */
function photoArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === "string" && item) {
      out.push(item);
    } else if (isRecord(item)) {
      const original = typeof item.original === "string" ? item.original : "";
      const thumbnail = typeof item.thumbnail === "string" ? item.thumbnail : "";
      const url = original || thumbnail;
      if (url) out.push(url);
    }
  }
  return out;
}

/**
 * KP descriptions ship as fragmentary HTML (`<p>`, `<br>`, `<strong>`, …).
 * Render to clean plain text with paragraph/line breaks preserved — the live
 * site renders them this way too, and parsing arbitrary HTML inside the
 * widget iframe is a footgun. Drops everything else and decodes entities.
 */
function htmlToText(html: string): string {
  if (!html) return "";
  let s = html;
  // Block elements → double newline.
  s = s.replace(/<\/(p|div|li|h[1-6])>/gi, "\n\n");
  s = s.replace(/<(p|div|h[1-6])[^>]*>/gi, "");
  // Line breaks.
  s = s.replace(/<br\s*\/?\s*>/gi, "\n");
  // List items get a leading bullet before tags are stripped.
  s = s.replace(/<li[^>]*>/gi, "• ");
  // Strip every remaining tag.
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, "");
  // Decode common HTML entities.
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
  // Collapse 3+ blank lines and trim.
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

function pickUser(raw: unknown): KpUser {
  const u: UnknownRecord = isRecord(raw) ? raw : {};
  return {
    userId: str(u.userId),
    username: str(u.username),
    userLocation: str(u.userLocation),
    reviewsPositive: str(u.reviewsPositive),
    reviewsNegative: str(u.reviewsNegative),
    hasPhone: bool(u.hasPhone),
    phone: str(u.phone),
    userActiveAdCount: num(u.userActiveAdCount),
    hasUserVerifiedBankAccount: bool(u.hasUserVerifiedBankAccount),
    hasCompanyVerifiedBankAccount: bool(u.hasCompanyVerifiedBankAccount),
    companyPib: str(u.companyPib),
    companyMbr: str(u.companyMbr),
    created: str(u.created),
  };
}

function pickImage(raw: unknown): string {
  const url = str(raw);
  // Detail pages occasionally return a malformed concat (e.g.
  // "https://images.kupujemprodajem.comundefined"). Reject those.
  if (!url || url.endsWith("undefined") || url.endsWith("null")) return "";
  return url;
}

/**
 * Rewrite a full-size KP image URL to its 300×300 thumbnail variant.
 *
 *   .../oglasi/9/89/123993899/123993899_xyz.jpg
 *   →
 *   .../oglasi/9/89/123993899/tmb-300x300-123993899_xyz.jpg
 */
function thumbnailUrl(fullUrl: string): string {
  const slash = fullUrl.lastIndexOf("/");
  if (slash <= 0) return fullUrl;
  const dir = fullUrl.slice(0, slash + 1);
  const file = fullUrl.slice(slash + 1);
  if (file.startsWith("tmb-")) return fullUrl;
  return `${dir}tmb-300x300-${file}`;
}

/**
 * In-memory cache of image data URLs (per server lifetime). KP thumbnails are
 * 5–15 KB each, capped to ~200 KB total per typical search. Caching dedupes
 * repeated fetches when the same listing shows up across queries.
 */
const dataUrlCache = new Map<string, string>();
// Per-thumbnail cap. 25 KB raw → ~33 KB base64. With default limit=10 a search
// response stays under ~340 KB total; at limit=20 it stays under ~700 KB.
// claude.ai web's tool-result cap is ~1 MB-ish, so this leaves headroom.
const MAX_INLINE_BYTES = 25_000;
const INLINE_TIMEOUT_MS = 4_000;

async function inlineImage(url: string): Promise<string> {
  if (!url) return "";
  const cached = dataUrlCache.get(url);
  if (cached !== undefined) return cached;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), INLINE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": BROWSER_HEADERS["User-Agent"] ?? "" },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      dataUrlCache.set(url, "");
      return "";
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_INLINE_BYTES) {
      dataUrlCache.set(url, "");
      return "";
    }
    const mime = res.headers.get("content-type") || "image/jpeg";
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    dataUrlCache.set(url, dataUrl);
    return dataUrl;
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Rewrite every product/listing image URL to an inlined `data:` URL.
 *
 * claude.ai's web client enforces a strict iframe CSP (`img-src 'self' data:
 * blob:`) and ignores the MCP App spec's `csp.resourceDomains`. Inlining is
 * the only way images render there. Claude Desktop honors the allowlist and
 * doesn't strictly need this, but inlining everywhere keeps behavior uniform.
 */
async function inlineProductImages<T extends { image: string }>(
  products: T[],
): Promise<void> {
  await Promise.all(
    products.map(async (p) => {
      if (!p.image) return;
      const dataUrl = await inlineImage(thumbnailUrl(p.image));
      if (dataUrl) p.image = dataUrl;
      else p.image = ""; // CSP would block the bare URL anyway — nuke it.
    }),
  );
}

async function inlineListingPhotos(listing: KpListing): Promise<void> {
  // Inline only the first 6 to cap payload — Claude rarely needs more on first read.
  const photoUrls = listing.photos.slice(0, 6);
  const inlined = await Promise.all(photoUrls.map((url) => inlineImage(thumbnailUrl(url))));
  listing.photos = inlined.filter((u) => u.length > 0);
  if (listing.image) {
    const heroData = await inlineImage(thumbnailUrl(listing.image));
    listing.image = heroData;
  }
}

function pickProduct(raw: unknown, fallbackId?: string): KpProduct {
  const p: UnknownRecord = isRecord(raw) ? raw : {};
  const idValue = p.id !== undefined ? num(p.id) : num(fallbackId);
  return {
    id: idValue,
    name: str(p.name),
    adUrl: absUrl(str(p.adUrl)),
    priceText: str(p.priceText),
    priceNumber: num(p.priceNumber),
    currency: str(p.currency),
    location: str(p.location),
    image: pickImage(p.image),
    description: htmlToText(str(p.description)),
    categoryName: str(p.categoryName),
    categoryId: num(p.categoryId),
    groupName: str(p.groupName),
    groupId: num(p.groupId),
    posted: str(p.posted),
    postedDesc: str(p.postedDesc),
    viewCount: str(p.viewCount),
    favoriteCount: num(p.favoriteCount),
    condition: str(p.condition),
    isCar: bool(p.isCar),
    isJob: bool(p.isJob),
    isExchange: bool(p.isExchange),
    isPriceFixed: bool(p.isPriceFixed),
    user: pickUser(p.user),
  };
}

function pickListing(raw: unknown): KpListing {
  const base = pickProduct(raw);
  const p: UnknownRecord = isRecord(raw) ? raw : {};
  return {
    ...base,
    photos: photoArray(p.photos),
    carInformation: str(p.carInformation),
    carOptions: str(p.carOptions),
    carNotes: str(p.carNotes),
    carMakeYear: str(p.carMakeYear),
    carKm: str(p.carKm),
    carCc: str(p.carCc),
    carFuelType: str(p.carFuelType),
    carModelDesc: str(p.carModelDesc),
    isImmediateAvailable: bool(p.isImmediateAvailable),
    isLocalPickupAvailable: bool(p.isLocalPickupAvailable),
    isCourierDeliveryAvailable: bool(p.isCourierDeliveryAvailable),
    localPickupDetailedInfo: str(p.localPickupDetailedInfo),
    courierDeliveryDetailedInfo: str(p.courierDeliveryDetailedInfo),
    website: str(p.website),
    video: str(p.video),
  };
}

function absUrl(maybeRelative: string): string {
  if (!maybeRelative) return "";
  if (maybeRelative.startsWith("http://") || maybeRelative.startsWith("https://")) {
    return maybeRelative;
  }
  return new URL(maybeRelative, KP_ORIGIN).toString();
}

/**
 * Read the Redux store embedded in `__NEXT_DATA__`.
 *
 * KP renamed the slot from `initialState` to `initialReduxState` in a recent
 * site rev; both are checked so the parser keeps working if they roll it back.
 */
function getReduxState(nextData: UnknownRecord): UnknownRecord {
  const props = isRecord(nextData.props) ? nextData.props : {};
  for (const key of ["initialReduxState", "initialState"] as const) {
    const slot = props[key];
    if (isRecord(slot)) return slot;
  }
  return {};
}

/** Search results live in `state.search.byId` (id → product). */
function getSearchById(nextData: UnknownRecord): UnknownRecord {
  const state = getReduxState(nextData);
  const search = isRecord(state.search) ? state.search : {};
  return isRecord(search.byId) ? search.byId : {};
}

/** Single-ad pages put the ad in `state.ad.byId` keyed by its numeric id. */
function getAdDetail(nextData: UnknownRecord, url: string): unknown {
  const state = getReduxState(nextData);
  const ad = isRecord(state.ad) ? state.ad : {};
  const byId = isRecord(ad.byId) ? ad.byId : {};
  const entries = Object.entries(byId);

  // Prefer matching by the numeric id present in the URL (e.g. `/oglas/.../163873542`).
  const idFromUrl = url.match(/(\d{6,})(?:[\/?#]|$)/)?.[1];
  if (idFromUrl) {
    const direct = byId[idFromUrl];
    if (direct !== undefined) return direct;
  }
  if (entries.length === 1) return entries[0]?.[1];

  // Fallback: any other slice with a single byId entry (covers schema drift).
  for (const slice of Object.values(state)) {
    if (!isRecord(slice)) continue;
    const sliceById = isRecord(slice.byId) ? slice.byId : null;
    if (!sliceById) continue;
    const items = Object.values(sliceById);
    if (items.length === 1) return items[0];
  }
  return undefined;
}

async function fetchSearchByIdOnce(searchUrl: string): Promise<UnknownRecord> {
  const html = await fetchHtml(searchUrl);
  const nextData = parseNextData(html);
  return getSearchById(nextData);
}

export async function searchProducts(params: KpSearchParams): Promise<{
  products: KpProduct[];
  searchUrl: string;
}> {
  const searchUrl = buildSearchUrl(params);

  let byId = await fetchSearchByIdOnce(searchUrl);
  // Cold-start mitigation: the first request from a fresh datacenter IP gets
  // a stripped HTML without `initialReduxState.search.byId`. Sometimes a stale
  // session cookie also poisons subsequent calls — clearing the jar before
  // retry forces KP to mint a fresh session.
  if (Object.keys(byId).length === 0) {
    cookieJar.clear();
    byId = await fetchSearchByIdOnce(searchUrl);
  }

  const products: KpProduct[] = Object.entries(byId).map(([pid, raw]) =>
    pickProduct(raw, pid),
  );
  await inlineProductImages(products);
  return { products, searchUrl };
}

async function fetchAdNodeOnce(url: string): Promise<unknown> {
  const html = await fetchHtml(url);
  const nextData = parseNextData(html);
  return getAdDetail(nextData, url);
}

export async function fetchListing(url: string): Promise<KpListing> {
  if (!url.includes("kupujemprodajem.com")) {
    throw new Error(
      `URL must be a kupujemprodajem.com listing; got: ${url}`,
    );
  }
  let adNode = await fetchAdNodeOnce(url);
  // Same cold-start / stale-session mitigation as searchProducts.
  if (adNode === undefined) {
    cookieJar.clear();
    adNode = await fetchAdNodeOnce(url);
  }
  if (adNode === undefined) {
    throw new Error("Could not locate ad detail in __NEXT_DATA__");
  }
  const listing = pickListing(adNode);
  await inlineListingPhotos(listing);
  return listing;
}

/** Re-export for tool input validation. */
export const KP_CONDITIONS = ["new", "used", "as-new", "damaged"] as const satisfies readonly KpCondition[];
