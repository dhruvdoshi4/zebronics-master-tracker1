import type { LucideIcon } from "lucide-react";
import {
  QCOM_HO_STOCK_CATALOG_MARKETPLACE,
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
import {
  catalogWorkspaceLabel,
  catalogWorkspaceFromEmail,
  type UploadHistoryScope,
} from "./catalog-workspace";
import { normalizeLoginEmail } from "./welcome-users";

export type AppTenant = "marketplace" | "quickcommerce" | "personal_audio";

export type { UploadHistoryScope };
export { uploadRowMatchesHistoryScope } from "./catalog-workspace";

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
  if (catalogWorkspaceFromEmail(key) === "personal_audio") return "personal_audio";

  return "marketplace";
}

export function getDefaultAppPath(email: string | null | undefined): string {
  const tenant = getAppTenant(email);
  if (tenant === "quickcommerce") return "/app/qcom/upload";
  if (tenant === "personal_audio") return "/app/pa/upload";
  return "/app/upload";
}

/** After login or welcome splash — marketplace users may still see /welcome first. */
export function getPostLoginPath(
  email: string | null | undefined,
  hasWelcomeSplash: boolean,
): string {
  if (hasWelcomeSplash) return "/welcome";
  return getDefaultAppPath(email);
}

export function getTenantSubtitle(tenant: AppTenant): string {
  if (tenant === "quickcommerce") return "Quick Commerce";
  if (tenant === "personal_audio") return catalogWorkspaceLabel("personal_audio");
  return catalogWorkspaceLabel("monitor_projector");
}

export type NavItem = { to: string; label: string; icon: LucideIcon };

const PERSONAL_AUDIO_NAV_ITEMS: NavItem[] = [
  { to: "/app/pa/upload", label: "Upload Center", icon: Database },
  { to: "/app/pa/lookup", label: "Product Lookup", icon: Search },
  { to: "/app/pa/amazon", label: "Amazon Dashboard", icon: BarChart3 },
  { to: "/app/pa/flipkart", label: "Flipkart Dashboard", icon: BarChart3 },
  { to: "/app/pa/analysis", label: "Data analysis", icon: LineChart },
  { to: "/app/pa/gms", label: "GMS Tracker", icon: IndianRupee },
  { to: "/app/pa/ho-stock", label: "HO Stock", icon: Warehouse },
  { to: "/app/pa/products", label: "Product Master", icon: Package },
];

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
  if (tenant === "personal_audio") return PERSONAL_AUDIO_NAV_ITEMS;
  return MARKETPLACE_NAV_ITEMS;
}

export function isQuickCommerceAppPath(pathname: string): boolean {
  return pathname === "/app/qcom" || pathname.startsWith("/app/qcom/");
}

export function isPersonalAudioAppPath(pathname: string): boolean {
  return pathname === "/app/pa" || pathname.startsWith("/app/pa/");
}

export function isMarketplaceOnlyAppPath(pathname: string): boolean {
  if (!pathname.startsWith("/app")) return false;
  if (pathname === "/app" || pathname === "/app/") return false;
  if (isQuickCommerceAppPath(pathname)) return false;
  if (isPersonalAudioAppPath(pathname)) return false;
  if (pathname === "/app/ho-stock" || pathname.startsWith("/app/ho-stock/")) {
    return false;
  }
  return true;
}
