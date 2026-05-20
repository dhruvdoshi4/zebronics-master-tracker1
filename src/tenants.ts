import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Database,
  IndianRupee,
  LineChart,
  Package,
  Search,
  Warehouse,
} from "lucide-react";
import { normalizeLoginEmail } from "./welcome-users";

export type AppTenant = "marketplace" | "quickcommerce";

export type QuickCommerceChannel = "zepto" | "blinkit" | "bigbasket" | "instamart";

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

export function qcomDashboardPath(channel: QuickCommerceChannel): string {
  return `/app/qcom/${channel}`;
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

export function getDefaultAppPath(email: string | null | undefined): string {
  return getAppTenant(email) === "quickcommerce"
    ? qcomDashboardPath("zepto")
    : "/app/upload";
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

export function getNavItemsForTenant(tenant: AppTenant): NavItem[] {
  if (tenant === "quickcommerce") {
    return QCOM_CHANNELS.map((channel) => ({
      to: qcomDashboardPath(channel),
      label: `${QCOM_CHANNEL_LABELS[channel]} Dashboard`,
      icon: BarChart3,
    }));
  }
  return MARKETPLACE_NAV_ITEMS;
}

export function isQuickCommerceAppPath(pathname: string): boolean {
  return pathname === "/app/qcom" || pathname.startsWith("/app/qcom/");
}

export function isMarketplaceOnlyAppPath(pathname: string): boolean {
  if (!pathname.startsWith("/app")) return false;
  if (pathname === "/app" || pathname === "/app/") return false;
  return !isQuickCommerceAppPath(pathname);
}
