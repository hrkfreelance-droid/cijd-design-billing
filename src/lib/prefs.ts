"use client";

import type { Locale } from "@/lib/i18n";

/**
 * Preferences live in localStorage, which is an external store — reading it
 * through useSyncExternalStore keeps the server render and the browser in
 * agreement without a mount effect. The same subscription carries OS colour
 * scheme changes, so appearance follows the system until the user picks a side.
 */
const THEME_KEY = "cijd.theme";
const LOCALE_KEY = "cijd.locale";
const CLIENT_KEY = "cijd.client";

export type Theme = "light" | "dark";

const listeners = new Set<() => void>();
let wired = false;

function notify() {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!wired && typeof window !== "undefined") {
    wired = true;
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", notify);
    window.addEventListener("storage", notify);
  }
  return () => {
    listeners.delete(listener);
  };
}

export function getTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function setTheme(theme: Theme) {
  localStorage.setItem(THEME_KEY, theme);
  notify();
}

export function getLocale(): Locale {
  const stored = localStorage.getItem(LOCALE_KEY);
  if (stored === "ja" || stored === "en") return stored;
  return navigator.language.startsWith("ja") ? "ja" : "en";
}

export function setLocale(locale: Locale) {
  localStorage.setItem(LOCALE_KEY, locale);
  notify();
}

export function getClientId(): string | null {
  return localStorage.getItem(CLIENT_KEY);
}

export function setClientId(clientId: string | null) {
  if (clientId) localStorage.setItem(CLIENT_KEY, clientId);
  else localStorage.removeItem(CLIENT_KEY);
  notify();
}

/* Values used for the server render and hydration. */
export const serverTheme = (): Theme => "light";
export const serverLocale = (): Locale => "ja";
export const serverClientId = (): string | null => null;
export const serverMounted = () => false;
export const clientMounted = () => true;
