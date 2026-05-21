import type { Marketplace, QcomMarketplace } from "./types";
import { isQcomMarketplace, QCOM_HO_STOCK_CATALOG_MARKETPLACE } from "./types";
import {
  QCOM_CHANNEL_LABELS,
  QCOM_WORKSPACE_LABELS,
  type QcomWorkspaceKey,
  type QuickCommerceChannel,
} from "./tenants";

export function marketplaceLabel(marketplace: Marketplace): string {
  if (marketplace === QCOM_HO_STOCK_CATALOG_MARKETPLACE) return "Consolidated";
  if (isQcomMarketplace(marketplace)) {
    return QCOM_CHANNEL_LABELS[marketplace as QuickCommerceChannel];
  }
  return marketplace === "amazon" ? "Amazon" : "Flipkart";
}

export function productCodeLabel(marketplace: Marketplace): string {
  if (marketplace === QCOM_HO_STOCK_CATALOG_MARKETPLACE) return "ASIN / FSN";
  if (marketplace === "amazon") return "ASIN";
  if (marketplace === "flipkart") return "FSN";
  if (marketplace === "zepto") return "PVID";
  if (marketplace === "blinkit") return "Item ID";
  if (marketplace === "bigbasket") return "Item ID";
  if (marketplace === "instamart") return "Item Code";
  return "ASIN / Item Code";
}

export function qcomMarketplaceFromChannel(channel: QuickCommerceChannel): QcomMarketplace {
  return channel;
}

export function qcomWorkspaceLabel(key: QcomWorkspaceKey): string {
  return QCOM_WORKSPACE_LABELS[key];
}
