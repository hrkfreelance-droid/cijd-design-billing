import type { Locale } from "@/lib/i18n";

/** Round monetary calculations to cents before formatting or persistence. */
export function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/** $225 for round numbers, $22.50 when cents matter. */
export function money(amount: number): string {
  const rounded = roundMoney(amount);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(rounded);
}

/** Fixed two-decimal USD display for accounting and invoice records. */
export function moneyExact(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(roundMoney(amount));
}

function intlLocale(locale: Locale): string {
  return locale === "ja" ? "ja-JP" : locale === "kh" ? "km-KH" : "en-US";
}

function parse(date: string): Date {
  return new Date(`${date}T00:00:00`);
}

export function shortDate(date: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
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
  return new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(value);
}

export function mediumDate(date: string | null | undefined, locale: Locale): string {
  if (!date) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(parse(date));
}

export function monthLabel(monthKey: string, locale: Locale): string {
  const [year, month] = monthKey.split("-");
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "long",
  }).format(new Date(Number(year), Number(month) - 1, 1));
}

export function todayIso(): string {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
}
