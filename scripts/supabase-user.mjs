#!/usr/bin/env node

/**
 * Provision one CIJD operator in Supabase Auth and public.users.
 *
 * This is intentionally a server-side CLI helper. The password is never
 * accepted as a command-line argument, so it does not enter shell history.
 * SUPABASE_SERVICE_ROLE_KEY is read from the environment or the ignored
 * .env.local file and is never printed.
 */
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const ROLES = new Set(["DESIGNER", "BILLING", "ACCOUNTING", "PRINTING", "ADMIN"]);

export function parseArgs(argv) {
  const args = { email: "", role: "", name: "", help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") {
      args.help = true;
      continue;
    }
    if (value === "--password") {
      throw new Error("Passwords are never accepted on the command line; use the hidden prompt.");
    }
    if (!["--email", "--role", "--name"].includes(value)) {
      throw new Error(`Unknown option: ${value}`);
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`${value} requires a value.`);
    args[value.slice(2)] = next;
    index += 1;
  }
  return args;
}

export function validateArgs(args) {
  if (args.help) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.email)) {
    throw new Error("A valid --email is required.");
  }
  args.role = args.role.toUpperCase();
  if (!ROLES.has(args.role)) {
    throw new Error("--role must be DESIGNER, BILLING, ACCOUNTING, PRINTING, or ADMIN.");
  }
  if (args.name && args.name.trim().length > 120) {
    throw new Error("--name must be 120 characters or fewer.");
  }
}

export function passwordPolicyProblem(value) {
  if (typeof value !== "string" || value.length < 12 || value.length > 128) {
    return "Password must be 12-128 characters with upper-case, lower-case and a number.";
  }
  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/[0-9]/.test(value)) {
    return "Password must be 12-128 characters with upper-case, lower-case and a number.";
  }
  return null;
}

function usage() {
  return [
    "Usage:",
    "  npm run supabase:user -- --email person@example.com --role DESIGNER|BILLING|ACCOUNTING|PRINTING|ADMIN [--name \"Display name\"]",
    "",
    "The password is requested interactively and is never accepted as an argument.",
    "Set SUPABASE_SERVICE_ROLE_KEY only in the server-side environment or ignored .env.local.",
  ].join("\n");
}

async function loadLocalEnv() {
  const file = process.env.CIJD_ENV_FILE || path.join(process.cwd(), ".env.local");
  let contents;
  try {
    contents = await readFile(file, "utf8");
  } catch {
    return;
  }
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function readHidden(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("A TTY is required for the password prompt; do not pipe a password.");
  }
  return new Promise((resolve, reject) => {
    let answer = "";
    const onData = (chunk) => {
      const text = String(chunk);
      for (const character of text) {
        if (character === "\u0003") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", onData);
          reject(new Error("Cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          process.stdout.write("\n");
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", onData);
          resolve(answer);
          return;
        }
        if (character === "\u007f") {
          answer = answer.slice(0, -1);
          continue;
        }
        if (character >= " ") answer += character;
      }
    };
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

async function password() {
  const fromEnv = process.env.SUPABASE_USER_PASSWORD;
  const first = fromEnv || (await readHidden("Password (hidden): "));
  const second = fromEnv || (await readHidden("Password again (hidden): "));
  const policyProblem = passwordPolicyProblem(first);
  if (policyProblem) throw new Error(policyProblem);
  if (first !== second) throw new Error("Passwords do not match.");
  return first;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  validateArgs(args);
  if (args.help) {
    console.log(usage());
    return;
  }
  await loadLocalEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required; no user was created.",
    );
  }

  const displayName = args.name.trim() || args.email.split("@", 1)[0];
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const created = await admin.auth.admin.createUser({
    email: args.email.trim().toLowerCase(),
    password: await password(),
    email_confirm: true,
    user_metadata: { name: displayName },
  });
  if (created.error || !created.data.user) {
    throw new Error("Supabase Auth user creation failed. If the email already exists, use the admin procedure in the runbook.");
  }

  const userId = created.data.user.id;
  const profile = await admin
    .from("users")
    .update({ name: displayName, role: args.role, active: true })
    .eq("id", userId)
    .select("id, name, role, active")
    .single();
  if (profile.error || !profile.data) {
    await admin.auth.admin.deleteUser(userId);
    throw new Error(
      "Auth user was created, but public.users could not be updated. The Auth user was rolled back.",
    );
  }

  const audit = await admin.from("audit_logs").insert({
    actor: process.env.CIJD_ADMIN_ACTOR || "Supabase setup",
    action: "user.provision",
    entity: "user",
    entity_id: userId,
    detail: `${args.role}: ${displayName}`,
  });
  if (audit.error) {
    throw new Error("User was created, but the provisioning audit record failed. Review audit_logs before proceeding.");
  }
  console.log(`Created ${args.role} user ${args.email.trim().toLowerCase()}. The password was not printed.`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "User provisioning failed.");
    process.exitCode = 1;
  }
}
