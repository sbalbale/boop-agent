import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { defineRuntimeTool } from "./runtimes/tool.js";
import { runtimeText, type RuntimeTool } from "./runtimes/types.js";

const NAMESPACE = "boop-skills";
const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "skills");

export interface SkillMeta {
  name: string;
  description: string;
}

interface Skill extends SkillMeta {
  body: string;
}

function parseFrontmatter(raw: string): { name?: string; description?: string; body: string } {
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
  return { name: meta.name, description: meta.description, body: body.trim() };
}

// Re-scanned on every call rather than cached at module scope — personal-
// scale usage (a handful of skill files) makes a fresh disk read every time
// cheap, and it means editing a SKILL.md takes effect immediately.
function loadSkills(): Skill[] {
  if (!existsSync(SKILLS_DIR)) return [];
  const skills: Skill[] = [];
  for (const entry of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(SKILLS_DIR, entry.name, "SKILL.md");
    if (!existsSync(skillPath)) continue;
    try {
      const { name, description, body } = parseFrontmatter(readFileSync(skillPath, "utf8"));
      if (!name || !description) {
        console.warn(`[skills] ${skillPath} missing name/description frontmatter, skipping`);
        continue;
      }
      skills.push({ name, description, body });
    } catch (err) {
      console.warn(`[skills] failed to read ${skillPath}`, err);
    }
  }
  return skills;
}

export function listSkills(): SkillMeta[] {
  return loadSkills().map(({ name, description }) => ({ name, description }));
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
  ];
}
