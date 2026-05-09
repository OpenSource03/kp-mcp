/**
 * KP category + group taxonomy, baked at build time.
 *
 * Source: crawled from kupujemprodajem.com homepage (88 top-level categories)
 * + page-1/2/3 of each category's broad listing (group ids harvested from
 * actual ad data — `groupId` and `groupName` are present on every search hit).
 *
 * The tree is intentionally static: KP rarely adds new groups, and a stale
 * group ID still works (KP ignores unknown values rather than erroring on
 * them in some places). Re-run `scripts/crawl-categories.ts` to refresh.
 */
export interface KpCategoryEntry {
  /** Top-level category name in Serbian, e.g. "Mobilni telefoni i oprema". */
  name: string;
  /** Map of groupId → groupName for this category. */
  groups: Record<string, string>;
}

export type KpCategoryTree = Record<string, KpCategoryEntry>;

import { CATEGORY_TREE_DATA } from "./data/categories-data.js";
export const CATEGORY_TREE: KpCategoryTree = CATEGORY_TREE_DATA;

/** Returns the category entry for a numeric category id, or undefined. */
export function categoryById(id: number | string): KpCategoryEntry | undefined {
  return CATEGORY_TREE[String(id)];
}

/** Returns the category id whose entry contains the given group id. */
export function categoryIdForGroup(groupId: number | string): number | undefined {
  const gid = String(groupId);
  for (const [cid, entry] of Object.entries(CATEGORY_TREE)) {
    if (entry.groups[gid]) return Number(cid);
  }
  return undefined;
}
