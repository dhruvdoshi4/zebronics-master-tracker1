import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function normalizeKey(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[_\s-]+/g, " ")
    .replace(/[^\w\s/]/g, "")
    .trim();
}

export function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim();
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const intFormatter = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 0,
});

const decimalFormatter = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
});

export function formatInteger(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return intFormatter.format(value);
}

export function formatDecimal(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return decimalFormatter.format(value);
}

