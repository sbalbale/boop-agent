import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { broadcast } from "./broadcast.js";
import { defineRuntimeTool } from "./runtimes/tool.js";
import { runtimeText, type RuntimeTool } from "./runtimes/types.js";

const NAMESPACE = "boop-skills";
const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "skills");
const MAX_BODY_LENGTH = 20_000;
const SKILL_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type SkillSource = "seed" | "self-authored";

export interface SkillMeta {
  name: string;
  description: string;
  source: SkillSource;
  updatedAt: number;
}

interface Skill extends SkillMeta {
  body: string;
}

function parseFrontmatter(
  raw: string,
): { name?: string; description?: string; source?: string; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { body: raw.trim() };
  const [, frontmatter, body] = match;
  const meta: Record<string, string> = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    meta[key] = value;
  }
  return { name: meta.name, description: meta.description, source: meta.source, body: body.trim() };
}

function skillPathFor(name: string): string {
  return join(SKILLS_DIR, name, "SKILL.md");
}

// Re-scanned on every call rather than cached at module scope — personal-
// scale usage (a handful of skill files) makes a fresh disk read every time
// cheap, and it means editing a SKILL.md (by hand or by the agent) takes
// effect immediately, no restart needed.
function loadSkills(): Skill[] {
  if (!existsSync(SKILLS_DIR)) return [];
  const skills: Skill[] = [];
  for (const entry of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(SKILLS_DIR, entry.name, "SKILL.md");
    if (!existsSync(skillPath)) continue;
    try {
      const raw = readFileSync(skillPath, "utf8");
      const { name, description, source, body } = parseFrontmatter(raw);
      if (!name || !description) {
        console.warn(`[skills] ${skillPath} missing name/description frontmatter, skipping`);
        continue;
      }
      skills.push({
        name,
        description,
        source: source === "self-authored" ? "self-authored" : "seed",
        updatedAt: statSync(skillPath).mtimeMs,
        body,
      });
    } catch (err) {
      console.warn(`[skills] failed to read ${skillPath}`, err);
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function listSkills(): SkillMeta[] {
  return loadSkills().map(({ name, description, source, updatedAt }) => ({
    name,
    description,
    source,
    updatedAt,
  }));
}

export function buildSkillIndex(): string {
  const skills = listSkills();
  if (skills.length === 0) return "(none yet)";
  return skills.map((s) => `- ${s.name}: ${s.description}`).join("\n");
}

export function loadSkillBody(name: string): string | null {
  const skill = loadSkills().find((s) => s.name === name);
  return skill ? skill.body : null;
}

// Full record (meta + body) for the dashboard's skills tab — separate from
// loadSkillBody so the HTTP route can return everything in one disk pass.
export function getSkill(name: string): Skill | null {
  return loadSkills().find((s) => s.name === name) ?? null;
}

export function listSkillsFull(): Skill[] {
  return loadSkills();
}

export interface WriteSkillResult {
  name: string;
  created: boolean;
}

// Lets the agent codify something it learned as a reusable skill, the same
// way a fix here has manually turned into a SKILL.md file all session —
// no confirmation gate, per explicit instruction. The blast radius is
// bounded to plain-text guidance files under server/skills/, not code, and
// overwriting an existing skill (including a seed one) is allowed since
// refining a skill IS the self-improvement loop this exists for; git history
// on the deployment host is the safety net against a bad overwrite.
export function writeSkill(
  name: string,
  description: string,
  body: string,
  source: SkillSource = "self-authored",
): WriteSkillResult {
  const trimmedName = name.trim().toLowerCase();
  if (!SKILL_NAME_RE.test(trimmedName) || trimmedName.length > 60) {
    throw new Error(
      `Invalid skill name "${name}" — must be lowercase kebab-case (letters, digits, hyphens), max 60 chars.`,
    );
  }
  const trimmedDescription = description.trim();
  if (!trimmedDescription) throw new Error("Skill description cannot be empty.");
  if (trimmedDescription.length > 300) {
    throw new Error("Skill description is too long (max 300 chars) — keep it to a one-line summary.");
  }
  const trimmedBody = body.trim();
  if (!trimmedBody) throw new Error("Skill body cannot be empty.");
  if (trimmedBody.length > MAX_BODY_LENGTH) {
    throw new Error(`Skill body is too long (${trimmedBody.length} chars, max ${MAX_BODY_LENGTH}).`);
  }

  const path = skillPathFor(trimmedName);
  const created = !existsSync(path);
  const frontmatter = [
    "---",
    `name: ${trimmedName}`,
    `description: ${JSON.stringify(trimmedDescription)}`,
    `source: ${source}`,
    "---",
    "",
  ].join("\n");
  mkdirSync(join(SKILLS_DIR, trimmedName), { recursive: true });
  writeFileSync(path, `${frontmatter}${trimmedBody}\n`, "utf8");
  broadcast("skill.written", { name: trimmedName, created, source });
  return { name: trimmedName, created };
}

// Dashboard-only (no runtime tool exposes this to the agent) — deletion is a
// one-way door, so it stays a deliberate user action rather than something
// the agent can do to its own guidance mid-task.
export function deleteSkill(name: string): void {
  const trimmedName = name.trim().toLowerCase();
  if (!SKILL_NAME_RE.test(trimmedName)) {
    throw new Error(`Invalid skill name "${name}".`);
  }
  const dir = join(SKILLS_DIR, trimmedName);
  if (!existsSync(join(dir, "SKILL.md"))) {
    throw new Error(`Skill "${trimmedName}" not found.`);
  }
  rmSync(dir, { recursive: true, force: true });
  broadcast("skill.written", { name: trimmedName, deleted: true });
}

export function createSkillTools(namespace = NAMESPACE): RuntimeTool[] {
  return [
    defineRuntimeTool(
      namespace,
      "use_skill",
      "Load the full instructions for one of the available skills by exact name (see the skills list in your system prompt). Call this before attempting a task that matches a skill's description.",
      {
        name: z.string().describe('Exact skill name from the skills list, e.g. "gmail-search".'),
      },
      async ({ name }) => {
        const body = loadSkillBody(name);
        if (!body) {
          const available = listSkills().map((s) => s.name);
          return runtimeText(
            `Unknown skill "${name}". Available skills: ${available.join(", ") || "(none)"}.`,
            false,
          );
        }
        return runtimeText(body);
      },
    ),
    defineRuntimeTool(
      namespace,
      "write_skill",
      'Save a new skill, or overwrite an existing one, so future turns (yours or a sub-agent\'s) can call use_skill(name) to load it instead of re-learning the same lesson. Use this when you work out a durable, reusable fix for a recurring tool-usage problem — not for one-off task results. "name" must be lowercase-kebab-case (e.g. "slack-thread-search"). "description" is the one-line summary shown in the skills index (keep it short). "body" is the full markdown instructions.',
      {
        name: z.string().describe('Lowercase kebab-case skill identifier, e.g. "slack-thread-search".'),
        description: z.string().describe("One-line summary shown in the always-visible skills index."),
        body: z.string().describe("Full markdown body with the actual guidance/instructions."),
      },
      async ({ name, description, body }) => {
        try {
          const result = writeSkill(name, description, body, "self-authored");
          return runtimeText(
            `${result.created ? "Created" : "Updated"} skill "${result.name}". It's now available via use_skill("${result.name}") on future turns.`,
          );
        } catch (err) {
          return runtimeText(err instanceof Error ? err.message : String(err), false);
        }
      },
    ),
  ];
}
