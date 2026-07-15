import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOUL_PATH = join(REPO_ROOT, "soul.md");
const SOUL_DEFAULT_PATH = join(REPO_ROOT, "soul.example.md");

const HARDCODED_FALLBACK =
  "Warm, witty, concise. Write like you're texting a friend. No corporate voice. No bullet dumps unless the user asked for a list.";

// soul.md is gitignored and user-owned (like .env.local) — this repo ships
// soul.example.md as the public default so a fresh clone still has a
// personality without anyone having to write one first. Re-read on every
// call, same reasoning as skills.ts: personal-scale usage makes a fresh
// disk read cheap, and it means editing soul.md takes effect immediately.
export function loadSoul(): string {
  for (const path of [SOUL_PATH, SOUL_DEFAULT_PATH]) {
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, "utf8").trim();
      if (raw) return raw;
    } catch (err) {
      console.warn(`[soul] failed to read ${path}`, err);
    }
  }
  return HARDCODED_FALLBACK;
}
