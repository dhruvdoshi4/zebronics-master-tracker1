import type { LucideIcon } from "lucide-react";
import {
  QCOM_HO_STOCK_CATALOG_MARKETPLACE,
  QCOM_MARKETPLACES,
  type Marketplace,
  type QcomSelloutMarketplace,
} from "./types";
import {
  BarChart3,
  Database,
  IndianRupee,
  Layers,
  LineChart,
  Package,
  Search,
  Warehouse,
} from "lucide-react";
import { isDawgAllowedAppPath, isDawgDataScope, resolveDataScope } from "./data-scope";
import { normalizeLoginEmail } from "./welcome-users";

export type AppTenant = "marketplace" | "quickcommerce";

export type QuickCommerceChannel = "zepto" | "blinkit" | "bigbasket" | "instamart";

/** Dashboard / PO / sellout workspace — includes Consolidated master tab. */
export type QcomWorkspaceKey = QuickCommerceChannel | "consolidated";

export const QCOM_WORKSPACE_KEYS: readonly QcomWorkspaceKey[] = [
  "consolidated",
  "zepto",
  "blinkit",
  "bigbasket",
  "instamart",
] as const;

export const QCOM_CHANNELS: readonly QuickCommerceChannel[] = [
  "zepto",
  "blinkit",
  "bigbasket",
  "instamart",
] as const;

export const QCOM_CHANNEL_LABELS: Record<QuickCommerceChannel, string> = {
  zepto: "Zepto",
  blinkit: "Blinkit",
  bigbasket: "Big Basket",
  instamart: "Instamart",
};

export const QCOM_WORKSPACE_LABELS: Record<QcomWorkspaceKey, string> = {
  consolidated: "Consolidated",
  zepto: "Zepto",
  blinkit: "Blinkit",
  bigbasket: "Big Basket",
  instamart: "Instamart",
};

export function qcomWorkspaceMarketplace(key: QcomWorkspaceKey): Marketplace {
  return key === "consolidated" ? QCOM_HO_STOCK_CATALOG_MARKETPLACE : key;
}

export function qcomDashboardPath(key: QcomWorkspaceKey): string {
  return `/app/qcom/${key}/dashboard`;
}

export function qcomChannelAnalysisPath(channel: QuickCommerceChannel): string {
  return `/app/qcom/${channel}/analysis`;
}

export function parseQcomWorkspaceKey(
  raw: string | undefined,
): QcomWorkspaceKey | null {
  if (raw === "consolidated") return "consolidated";
  return parseQuickCommerceChannel(raw);
}

export function qcomWorkspaceFromMarketplace(
  marketplace: QcomSelloutMarketplace,
): QcomWorkspaceKey {
  return marketplace === QCOM_HO_STOCK_CATALOG_MARKETPLACE ? "consolidated" : marketplace;
}

export function parseQuickCommerceChannel(
  raw: string | undefined,
): QuickCommerceChannel | null {
  if (raw && QCOM_CHANNELS.includes(raw as QuickCommerceChannel)) {
    return raw as QuickCommerceChannel;
  }
  return null;
}

const QUICKCOMMERCE_EMAILS = new Set([
  "qcom@zebronics.com",
  "quickcom@zebronics.com",
]);

function isQuickCommerceLocalPart(local: string): boolean {
  return (
    local === "qcom" ||
    local.startsWith("qcom.") ||
    local === "quickcom" ||
    local.startsWith("quickcom.")
  );
}

export function getAppTenant(email: string | null | undefined): AppTenant {
  if (!email) return "marketplace";
  const key = normalizeLoginEmail(email);
  if (QUICKCOMMERCE_EMAILS.has(key)) return "quickcommerce";

  const [local, domain] = key.split("@");
  if (!local || !domain?.endsWith("zebronics.com")) return "marketplace";
  if (isQuickCommerceLocalPart(local)) return "quickcommerce";

  return "marketplace";
}

export function getDefaultAppPath(
  email: string | null | undefined,
  profileScope?: "default" | "dawg" | null,
): string {
  return getAppTenant(email) === "quickcommerce"
    ? "/app/qcom/upload"
    : "/app/upload";
}

/** After login or welcome splash — marketplace users may still see /welcome first. */
export function getPostLoginPath(
  email: string | null | undefined,
  hasWelcomeSplash: boolean,
  profileScope?: "default" | "dawg" | null,
): string {
  if (hasWelcomeSplash) return "/welcome";
  return getDefaultAppPath(email, profileScope);
}

export function getTenantSubtitle(
  tenant: AppTenant,
  email?: string | null,
  profileScope?: "default" | "dawg" | null,
): string {
  if (isDawgDataScope(resolveDataScope({ profileScope, email }))) {
    return "Gaming - daWg";
  }
  return tenant === "quickcommerce" ? "Quick Commerce" : "Monitor + Projector";
}

export type NavItem = { to: string; label: string; icon: LucideIcon };

const MARKETPLACE_NAV_ITEMS: NavItem[] = [
  { to: "/app/upload", label: "Upload Center", icon: Database },
  { to: "/app/asin", label: "Product Lookup", icon: Search },
  { to: "/app/amazon", label: "Amazon Dashboard", icon: BarChart3 },
  { to: "/app/flipkart", label: "Flipkart Dashboard", icon: BarChart3 },
  { to: "/app/analysis", label: "Data analysis", icon: LineChart },
  { to: "/app/gms", label: "GMS Tracker", icon: IndianRupee },
  { to: "/app/ho-stock", label: "HO Stock", icon: Warehouse },
  { to: "/app/products", label: "Product Master", icon: Package },
];

export function getNavItemsForUser(
  email: string | null | undefined,
  tenant: AppTenant,
  profileScope?: "default" | "dawg" | null,
): NavItem[] {
  if (isDawgDataScope(resolveDataScope({ profileScope, email }))) {
    return MARKETPLACE_NAV_ITEMS;
  }
  return getNavItemsForTenant(tenant);
}

export function getNavItemsForTenant(tenant: AppTenant): NavItem[] {
  if (tenant === "quickcommerce") {
    return [
      { to: "/app/qcom/upload", label: "Upload Center", icon: Database },
      { to: "/app/qcom/lookup", label: "Product Lookup", icon: Search },
      {
        to: qcomDashboardPath("consolidated"),
        label: "Channel comparison",
        icon: BarChart3,
      },
      ...QCOM_CHANNELS.map((channel) => ({
        to: qcomDashboardPath(channel),
        label: QCOM_CHANNEL_LABELS[channel],
        icon: BarChart3,
      })),
      { to: "/app/qcom/analysis/category", label: "Category analysis", icon: Layers },
      { to: "/app/ho-stock", label: "HO Stock", icon: Warehouse },
    ];
  }
  return MARKETPLACE_NAV_ITEMS;
}

export function isQuickCommerceAppPath(pathname: string): boolean {
  return pathname === "/app/qcom" || pathname.startsWith("/app/qcom/");
}

export function isMarketplaceOnlyAppPath(pathname: string): boolean {
  if (!pathname.startsWith("/app")) return false;
  if (pathname === "/app" || pathname === "/app/") return false;
  if (isQuickCommerceAppPath(pathname)) return false;
  if (pathname === "/app/ho-stock" || pathname.startsWith("/app/ho-stock/")) {
    return false;
  }
  return true;
}

export type UploadHistoryScope = "marketplace" | "quickcommerce";

type UploadHistoryRowLike = {
  marketplace: string;
  upload_kind?: string | null;
  notes?: string | null;
};

/** Monitor / projector workspace vs Quick Commerce — keeps Upload Center history isolated. */
export function uploadRowMatchesHistoryScope(
  row: UploadHistoryRowLike,
  scope: UploadHistoryScope,
): boolean {
  const mp = row.marketplace;
  const isQcomUpload =
    mp === QCOM_HO_STOCK_CATALOG_MARKETPLACE ||
    (QCOM_MARKETPLACES as readonly string[]).includes(mp);
  return scope === "quickcommerce" ? isQcomUpload : !isQcomUpload;
}
