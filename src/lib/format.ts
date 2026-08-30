import type { Locale } from "@/lib/i18n";

/** $225 for round numbers, $22.50 when cents matter. */
export function money(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(rounded);
}

function parse(date: string): Date {
  return new Date(`${date}T00:00:00`);
}

export function shortDate(date: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US", {
    month: "short",
    day: "numeric",
  }).format(parse(date));
}

export function longDate(date: string, locale: Locale): string {
  const value = parse(date);
  if (locale === "ja") {
    const weekday = new Intl.DateTimeFormat("ja-JP", { weekday: "short" }).format(value);
    return `${value.getMonth() + 1}月${value.getDate()}日（${weekday.replace("曜日", "")}）`;
  }
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(value);
}

export function mediumDate(date: string | null | undefined, locale: Locale): string {
  if (!date) return "Unknown";
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(parse(date));
}

export function monthLabel(monthKey: string, locale: Locale): string {
  const [year, month] = monthKey.split("-");
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US", {
    year: "numeric",
    month: "long",
  }).format(new Date(Number(year), Number(month) - 1, 1));
}

export function todayIso(): string {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
}
