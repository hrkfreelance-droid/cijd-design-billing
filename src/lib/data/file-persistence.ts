import { promises as fs } from "node:fs";
import path from "node:path";

import type { Database } from "@/lib/types";
import type { Persistence } from "./store";

/** Override with CIJD_DATA_FILE to run against a throwaway store (tests). */
const DATA_FILE = process.env.CIJD_DATA_FILE
  ? path.resolve(process.env.CIJD_DATA_FILE)
  : path.join(process.cwd(), ".data", "db.json");

export const filePersistence: Persistence = {
  async read() {
    try {
      return JSON.parse(await fs.readFile(DATA_FILE, "utf8")) as Database;
    } catch {
      return null;
    }
  },
  async write(db) {
    try {
      await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
      await fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2), "utf8");
    } catch {
      // Read-only filesystem (e.g. a serverless host): stay in memory.
    }
  },
};
