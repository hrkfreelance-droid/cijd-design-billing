"use client";

import { createBrowserClient } from "@supabase/ssr";

import { supabaseConfig } from "./config";

/** Used only by the sign-in form; everything else goes through the server. */
export function supabaseBrowserClient() {
  const config = supabaseConfig();
  if (!config) return null;
  return createBrowserClient(config.url, config.anonKey);
}
