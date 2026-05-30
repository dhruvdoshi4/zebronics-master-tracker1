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
import {
  adminRealmLabel,
  isGlobalAdminEmail,
  readStoredAdminRealm,
} from "./admin-realm";
import { ADMIN_APP_PREFIX, adminDefaultUploadPath, isAdminAppPath } from "./admin-app-paths";
import { monitorDefaultUploadPath, MONITOR_APP_PREFIX } from "./monitor-app-paths";
import { isDawgDataScope, resolveDataScope } from "./data-scope";
import type { DataScope } from "./types";
import { normalizeLoginEmail } from "./welcome-users";

export type AppTenant =
  | "marketplace"
  | "quickcommerce"
  | "personal_audio"
  | "rithika"
  | "pravin"
  | "rishabh";

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
  if (isGlobalAdminEmail(key)) {
    return readStoredAdminRealm() === "qcom" ? "quickcommerce" : "marketplace";
  }
  if (QUICKCOMMERCE_EMAILS.has(key)) return "quickcommerce";

  const [local, domain] = key.split("@");
  if (!local || !domain?.endsWith("zebronics.com")) return "marketplace";
  if (isQuickCommerceLocalPart(local)) return "quickcommerce";
  const ws = catalogWorkspaceFromEmail(key);
  if (ws === "personal_audio") return "personal_audio";
  if (ws === "rithika_it_gaming") return "rithika";
  if (ws === "roma_powerbank") return "pravin";
  if (ws === "home_audio") return "rishabh";

  return "marketplace";
}

export function getDefaultAppPath(
  email: string | null | undefined,
  _profileScope?: DataScope | null,
): string {
  const tenant = getAppTenant(email);
  if (isGlobalAdminEmail(email)) {
    return readStoredAdminRealm() === "qcom" ? "/app/qcom/upload" : adminDefaultUploadPath();
  }
  if (tenant === "quickcommerce") return "/app/qcom/upload";
  if (tenant === "personal_audio") return "/app/pa/upload";
  if (tenant === "rithika") return "/app/ri/upload";
  if (tenant === "pravin") return "/app/pv/upload";
  if (tenant === "rishabh") return "/app/ha/upload";
  return monitorDefaultUploadPath();
}

/** After login or welcome splash — marketplace users may still see /welcome first. */
export function getPostLoginPath(
  email: string | null | undefined,
  hasWelcomeSplash: boolean,
  profileScope?: DataScope | null,
): string {
  if (hasWelcomeSplash) return "/welcome";
  return getDefaultAppPath(email, profileScope);
}

export function getTenantSubtitle(
  tenant: AppTenant,
  email?: string | null,
  profileScope?: DataScope | null,
): string {
  if (isGlobalAdminEmail(email)) {
    return adminRealmLabel(readStoredAdminRealm());
  }
  if (isDawgDataScope(resolveDataScope({ profileScope, email }))) {
    return "Gaming - daWg";
  }
  if (tenant === "quickcommerce") return "Quick Commerce";
  if (tenant === "personal_audio") return catalogWorkspaceLabel("personal_audio");
  if (tenant === "rithika") return catalogWorkspaceLabel("rithika_it_gaming");
  if (tenant === "pravin") return catalogWorkspaceLabel("roma_powerbank");
  if (tenant === "rishabh") return catalogWorkspaceLabel("home_audio");
  return catalogWorkspaceLabel("monitor_projector");
}

export type NavItem = { to: string; label: string; icon: LucideIcon };

const PRAVIN_NAV_ITEMS: NavItem[] = [
  { to: "/app/pv/upload", label: "Upload Center", icon: Database },
  { to: "/app/pv/lookup", label: "Product Lookup", icon: Search },
  { to: "/app/pv/amazon", label: "Amazon Dashboard", icon: BarChart3 },
  { to: "/app/pv/flipkart", label: "Flipkart Dashboard", icon: BarChart3 },
  { to: "/app/pv/analysis/category", label: "Category analysis", icon: Layers },
  { to: "/app/pv/gms", label: "GMS Tracker", icon: IndianRupee },
  { to: "/app/pv/ho-stock", label: "HO Stock", icon: Warehouse },
  { to: "/app/pv/products", label: "Product Master", icon: Package },
];

const RITHIKA_NAV_ITEMS: NavItem[] = [
  { to: "/app/ri/upload", label: "Upload Center", icon: Database },
  { to: "/app/ri/lookup", label: "Product Lookup", icon: Search },
  { to: "/app/ri/amazon", label: "Amazon Dashboard", icon: BarChart3 },
  { to: "/app/ri/flipkart", label: "Flipkart Dashboard", icon: BarChart3 },
  { to: "/app/ri/analysis", label: "Data analysis", icon: LineChart },
  { to: "/app/ri/gms", label: "GMS Tracker", icon: IndianRupee },
  { to: "/app/ri/ho-stock", label: "HO Stock", icon: Warehouse },
  { to: "/app/ri/products", label: "Product Master", icon: Package },
];

const RISHABH_NAV_ITEMS: NavItem[] = [
  { to: "/app/ha/upload", label: "Upload Center", icon: Database },
  { to: "/app/ha/lookup", label: "Product Lookup", icon: Search },
  { to: "/app/ha/amazon", label: "Amazon Dashboard", icon: BarChart3 },
  { to: "/app/ha/flipkart", label: "Flipkart Dashboard", icon: BarChart3 },
  { to: "/app/ha/analysis", label: "Data analysis", icon: LineChart },
  { to: "/app/ha/gms", label: "GMS Tracker", icon: IndianRupee },
  { to: "/app/ha/ho-stock", label: "HO Stock", icon: Warehouse },
  { to: "/app/ha/products", label: "Product Master", icon: Package },
];

const PERSONAL_AUDIO_NAV_ITEMS: NavItem[] = [
  { to: "/app/pa/upload", label: "Upload Center", icon: Database },
  { to: "/app/pa/lookup", label: "Product Lookup", icon: Search },
  { to: "/app/pa/amazon", label: "Amazon Dashboard", icon: BarChart3 },
  { to: "/app/pa/flipkart", label: "Flipkart Dashboard", icon: BarChart3 },
  { to: "/app/pa/analysis/category", label: "Category analysis", icon: Layers },
  { to: "/app/pa/gms", label: "GMS Tracker", icon: IndianRupee },
  { to: "/app/pa/ho-stock", label: "HO Stock", icon: Warehouse },
  { to: "/app/pa/products", label: "Product Master", icon: Package },
];

const MONITOR_NAV_ITEMS: NavItem[] = [
  { to: `${MONITOR_APP_PREFIX}/upload`, label: "Upload Center", icon: Database },
  { to: `${MONITOR_APP_PREFIX}/lookup`, label: "Product Lookup", icon: Search },
  { to: `${MONITOR_APP_PREFIX}/amazon`, label: "Amazon Dashboard", icon: BarChart3 },
  { to: `${MONITOR_APP_PREFIX}/flipkart`, label: "Flipkart Dashboard", icon: BarChart3 },
  { to: `${MONITOR_APP_PREFIX}/analysis/category`, label: "Category analysis", icon: Layers },
  { to: `${MONITOR_APP_PREFIX}/gms`, label: "GMS Tracker", icon: IndianRupee },
  { to: `${MONITOR_APP_PREFIX}/ho-stock`, label: "HO Stock", icon: Warehouse },
  { to: `${MONITOR_APP_PREFIX}/products`, label: "Product Master", icon: Package },
];

/** @deprecated Use {@link MONITOR_NAV_ITEMS}. */
export const MARKETPLACE_NAV_ITEMS = MONITOR_NAV_ITEMS;

const ADMIN_MARKETPLACE_NAV_ITEMS: NavItem[] = [
  { to: `${ADMIN_APP_PREFIX}/upload`, label: "Upload Center", icon: Database },
  { to: `${ADMIN_APP_PREFIX}/lookup`, label: "Product Lookup", icon: Search },
  { to: `${ADMIN_APP_PREFIX}/amazon`, label: "Amazon Dashboard", icon: BarChart3 },
  { to: `${ADMIN_APP_PREFIX}/flipkart`, label: "Flipkart Dashboard", icon: BarChart3 },
  { to: `${ADMIN_APP_PREFIX}/analysis/category`, label: "Category analysis", icon: Layers },
  { to: `${ADMIN_APP_PREFIX}/gms`, label: "GMS Tracker", icon: IndianRupee },
  { to: `${ADMIN_APP_PREFIX}/ho-stock`, label: "HO Stock", icon: Warehouse },
  { to: `${ADMIN_APP_PREFIX}/products`, label: "Product Master", icon: Package },
];

export function getNavItemsForUser(
  email: string | null | undefined,
  tenant: AppTenant,
  profileScope?: DataScope | null,
): NavItem[] {
  if (isGlobalAdminEmail(email) && readStoredAdminRealm() === "marketplace_global") {
    return ADMIN_MARKETPLACE_NAV_ITEMS;
  }
  if (isDawgDataScope(resolveDataScope({ profileScope, email }))) {
    return MONITOR_NAV_ITEMS;
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
      { to: "/app/qcom/ho-stock", label: "HO Stock", icon: Warehouse },
    ];
  }
  if (tenant === "personal_audio") return PERSONAL_AUDIO_NAV_ITEMS;
  if (tenant === "rithika") return RITHIKA_NAV_ITEMS;
  if (tenant === "pravin") return PRAVIN_NAV_ITEMS;
  if (tenant === "rishabh") return RISHABH_NAV_ITEMS;
  return MONITOR_NAV_ITEMS;
}

export function isQuickCommerceAppPath(pathname: string): boolean {
  return pathname === "/app/qcom" || pathname.startsWith("/app/qcom/");
}

export function isMonitorAppPath(pathname: string): boolean {
  return pathname === "/app/mp" || pathname.startsWith("/app/mp/");
}

export function isPersonalAudioAppPath(pathname: string): boolean {
  return pathname === "/app/pa" || pathname.startsWith("/app/pa/");
}

export function isRithikaAppPath(pathname: string): boolean {
  return pathname === "/app/ri" || pathname.startsWith("/app/ri/");
}

export function isPravinAppPath(pathname: string): boolean {
  return pathname === "/app/pv" || pathname.startsWith("/app/pv/");
}

export function isRishabhAppPath(pathname: string): boolean {
  return pathname === "/app/ha" || pathname.startsWith("/app/ha/");
}

export {
  isAdminAppPath,
  isLegacyBareAppPath,
  isLegacyBareAppPath as isHariMarketplaceAppPath,
} from "./admin-app-paths";
export { MONITOR_APP_PREFIX, monitorDefaultUploadPath } from "./monitor-app-paths";

export function isMarketplaceOnlyAppPath(pathname: string): boolean {
  if (!pathname.startsWith("/app")) return false;
  if (pathname === "/app" || pathname === "/app/") return false;
  if (isAdminAppPath(pathname)) return false;
  if (isQuickCommerceAppPath(pathname)) return false;
  if (isMonitorAppPath(pathname)) return false;
  if (isPersonalAudioAppPath(pathname)) return false;
  if (isRithikaAppPath(pathname)) return false;
  if (isPravinAppPath(pathname)) return false;
  if (isRishabhAppPath(pathname)) return false;
  if (pathname === "/app/ho-stock" || pathname.startsWith("/app/ho-stock/")) {
    return true;
  }
  return true;
}
