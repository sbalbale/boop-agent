import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function readIfExists(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

// For the dashboard editor: reports whether soul.md exists (a customized
// personality) or the response is just the default, so the UI can show
// "editing your customization" vs. "editing a copy of the default" and offer
// a real "reset to default" action.
export function getSoulForEditing(): { content: string; isCustom: boolean } {
  const custom = readIfExists(SOUL_PATH);
  if (custom !== null) return { content: custom, isCustom: true };
  return { content: readIfExists(SOUL_DEFAULT_PATH) ?? HARDCODED_FALLBACK, isCustom: false };
}

const MAX_SOUL_LENGTH = 10_000;

export function saveSoul(content: string): void {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("Soul content cannot be empty.");
  if (trimmed.length > MAX_SOUL_LENGTH) {
    throw new Error(`Soul content is too long (${trimmed.length} chars, max ${MAX_SOUL_LENGTH}).`);
  }
  writeFileSync(SOUL_PATH, `${trimmed}\n`, "utf8");
}

// Deletes the user's soul.md override, reverting to soul.example.md.
export function resetSoul(): void {
  if (existsSync(SOUL_PATH)) rmSync(SOUL_PATH);
}
