/**
 * Domain types for kupujemprodajem.com listings.
 *
 * Only the fields useful to a downstream LLM consumer are kept — the original
 * site embeds many UI-state flags (isDisplayGoldHeader, isTopSearch, …) that
 * would only burn tokens. If a new field is genuinely needed, add it here.
 */

export interface KpUser {
  userId: string;
  username: string;
  userLocation: string;
  reviewsPositive: string;
  reviewsNegative: string;
  hasPhone: boolean;
  phone: string;
  userActiveAdCount: number;
  hasUserVerifiedBankAccount: boolean;
  hasCompanyVerifiedBankAccount: boolean;
  companyPib: string;
  companyMbr: string;
  created: string;
}

/** Lean product shape returned by `search_kp` (one entry per search hit). */
export interface KpProduct {
  id: number;
  name: string;
  adUrl: string;
  priceText: string;
  priceNumber: number;
  currency: string;
  location: string;
  image: string;
  description: string;
  categoryName: string;
  categoryId: number;
  groupName: string;
  groupId: number;
  posted: string;
  postedDesc: string;
  viewCount: string;
  favoriteCount: number;
  condition: string;
  isCar: boolean;
  isJob: boolean;
  isExchange: boolean;
  isPriceFixed: boolean;
  user: KpUser;
}

/** Richer detail shape returned by `fetch_listing`. */
export interface KpListing extends KpProduct {
  photos: string[];
  carInformation: string;
  carOptions: string;
  carNotes: string;
  carMakeYear: string;
  carKm: string;
  carCc: string;
  carFuelType: string;
  carModelDesc: string;
  isImmediateAvailable: boolean;
  isLocalPickupAvailable: boolean;
  isCourierDeliveryAvailable: boolean;
  localPickupDetailedInfo: string;
  courierDeliveryDetailedInfo: string;
  website: string;
  video: string;
}

export type KpCurrency = "eur" | "rsd";

export type KpCondition = "new" | "used" | "as-new" | "damaged";

export type KpOrderBy =
  | "price"
  | "price desc"
  | "posted desc"
  | "view_count desc"
  | "relevance";

export interface KpSearchParams {
  query: string;
  priceFrom?: number;
  priceTo?: number;
  currency?: KpCurrency;
  condition?: KpCondition[];
  categoryId?: number;
  orderBy?: KpOrderBy;
  page?: number;
}
