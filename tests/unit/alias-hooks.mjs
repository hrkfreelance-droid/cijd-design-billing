import { existsSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = resolvePath(dirname(fileURLToPath(import.meta.url)), "../../src");

/**
 * Teaches `node --test` how this project's imports are written, so the V2
 * library can be unit tested exactly as the app imports it: the `@/*` alias
 * from tsconfig, and extensionless specifiers, both resolved the way the
 * bundler resolves them.
 */
const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", "/index.ts", "/index.tsx"];

function firstExisting(basePath) {
  if (existsSync(basePath) && !basePath.endsWith("/")) return basePath;
  for (const extension of EXTENSIONS) {
    const candidate = `${basePath}${extension}`;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const found = firstExisting(join(SRC, specifier.slice(2)));
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  } else if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const found = firstExisting(join(dirname(fileURLToPath(context.parentURL)), specifier));
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
