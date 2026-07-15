import { useEffect, useState, useCallback } from "react";
import { useSocket, type SocketEvent } from "../lib/useSocket.js";
import {
  EmptyState,
  HeaderPill,
  PanelPage,
  bodyTextClass,
  mutedTextClass,
  panelCardClass,
} from "./PanelPrimitives.js";

interface Skill {
  name: string;
  description: string;
  source: "seed" | "self-authored";
  updatedAt: number;
  body: string;
}

interface SkillForm {
  name: string;
  description: string;
  body: string;
}

const EMPTY_FORM: SkillForm = { name: "", description: "", body: "" };
const NEW_SKILL_SENTINEL = "__new__";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function inputClass(isDark: boolean): string {
  return `w-full rounded-xl border px-3 py-2 text-xs outline-none transition-colors focus:border-zinc-400 ${
    isDark ? "bg-[#17171a] border-white/10 text-zinc-100" : "bg-zinc-50 border-zinc-200 text-zinc-900"
  }`;
}

function primaryButtonClass(isDark: boolean): string {
  return `rounded-xl px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
    isDark ? "bg-zinc-100 text-zinc-950 hover:bg-white" : "bg-zinc-950 text-white hover:bg-zinc-800"
  }`;
}

function ghostButtonClass(isDark: boolean): string {
  return `rounded-xl px-3 py-1.5 text-xs font-medium transition ${
    isDark ? "text-zinc-400 hover:text-zinc-100" : "text-zinc-500 hover:text-zinc-900"
  }`;
}

export function SkillsPanel({ isDark }: { isDark: boolean }) {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<SkillForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/skills", { cache: "no-store" });
      if (!res.ok) throw new Error(`Skills fetch failed (${res.status})`);
      const json = (await res.json()) as { skills: Skill[] };
      setSkills(json.skills);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useSocket((evt: SocketEvent) => {
    if (evt.event === "skill.written") load();
  });

  function startCreate() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setEditing(NEW_SKILL_SENTINEL);
    setExpanded(null);
  }

  function startEdit(skill: Skill) {
    setForm({ name: skill.name, description: skill.description, body: skill.body });
    setFormError(null);
    setEditing(skill.name);
    setExpanded(skill.name);
  }

  function cancelEdit() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  }

  async function saveForm() {
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `Save failed (${res.status})`);
      setEditing(null);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteSkill(name: string) {
    setDeleting(name);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(name)}`, { method: "DELETE" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `Delete failed (${res.status})`);
      setConfirmDelete(null);
      if (editing === name) cancelEdit();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(null);
    }
  }

  const seedCount = skills?.filter((s) => s.source === "seed").length ?? 0;
  const selfAuthoredCount = skills?.filter((s) => s.source === "self-authored").length ?? 0;

  function renderForm(isNew: boolean) {
    return (
      <div className="space-y-3">
        <label className="flex flex-col gap-1">
          <span className={`text-[10px] font-medium uppercase tracking-[0.08em] ${mutedTextClass(isDark)}`}>
            Name (lowercase-kebab-case)
          </span>
          <input
            value={form.name}
            disabled={!isNew}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. slack-thread-search"
            className={`${inputClass(isDark)} mono disabled:opacity-60`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={`text-[10px] font-medium uppercase tracking-[0.08em] ${mutedTextClass(isDark)}`}>
            Description (one line, shown in the always-visible index)
          </span>
          <input
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="One-sentence summary of when this skill applies"
            className={inputClass(isDark)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={`text-[10px] font-medium uppercase tracking-[0.08em] ${mutedTextClass(isDark)}`}>
            Body (full markdown instructions)
          </span>
          <textarea
            value={form.body}
            onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            rows={10}
            className={`${inputClass(isDark)} mono resize-y`}
          />
        </label>
        {formError && <p className="text-xs text-rose-500">{formError}</p>}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={saveForm}
            disabled={saving || !form.name.trim() || !form.description.trim() || !form.body.trim()}
            className={primaryButtonClass(isDark)}
          >
            {saving ? "Saving…" : isNew ? "Create skill" : "Save changes"}
          </button>
          <button type="button" onClick={cancelEdit} className={ghostButtonClass(isDark)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <PanelPage
      eyebrow="Agent"
      title="Skills"
      description="On-demand guidance the agent loads before a matching task, and can write for itself when it works out a durable fix."
      stat={
        skills && (
          <HeaderPill isDark={isDark}>
            {seedCount} built-in · {selfAuthoredCount} self-authored
          </HeaderPill>
        )
      }
      action={
        editing === null && (
          <button type="button" onClick={startCreate} className={primaryButtonClass(isDark)}>
            + New skill
          </button>
        )
      }
    >
      {error && (
        <div className={panelCardClass(isDark, "px-4 py-3 text-sm text-rose-500")}>{error}</div>
      )}

      {editing === NEW_SKILL_SENTINEL && (
        <div className={panelCardClass(isDark, "px-4 py-3.5")}>{renderForm(true)}</div>
      )}

      {!skills && !error && <EmptyState isDark={isDark}>Loading skills…</EmptyState>}

      {skills && skills.length === 0 && editing === null && (
        <EmptyState isDark={isDark}>No skills yet.</EmptyState>
      )}

      {skills && skills.length > 0 && (
        <div className="space-y-3">
          {skills.map((skill) => {
            const isOpen = expanded === skill.name;
            const isEditingThis = editing === skill.name;
            return (
              <div key={skill.name} className={panelCardClass(isDark, "overflow-hidden")}>
                <div className="flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : skill.name)}
                    className="min-w-0 flex-1 text-left"
                    disabled={isEditingThis}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="mono text-sm font-medium">{skill.name}</span>
                      <HeaderPill
                        isDark={isDark}
                        className={
                          skill.source === "self-authored"
                            ? isDark
                              ? "!border-emerald-400/30 !bg-emerald-400/10 !text-emerald-400"
                              : "!border-emerald-600/30 !bg-emerald-50 !text-emerald-700"
                            : ""
                        }
                      >
                        {skill.source === "self-authored" ? "self-authored" : "built-in"}
                      </HeaderPill>
                      <span className={`text-xs ${mutedTextClass(isDark)}`}>
                        updated {timeAgo(skill.updatedAt)}
                      </span>
                    </div>
                    <p className={`mt-1 text-sm ${bodyTextClass(isDark)}`}>{skill.description}</p>
                  </button>
                  {!isEditingThis && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : skill.name)}
                        className={ghostButtonClass(isDark)}
                      >
                        {isOpen ? "hide" : "view"}
                      </button>
                      <button type="button" onClick={() => startEdit(skill)} className={ghostButtonClass(isDark)}>
                        edit
                      </button>
                      {confirmDelete === skill.name ? (
                        <>
                          <button
                            type="button"
                            onClick={() => confirmDeleteSkill(skill.name)}
                            disabled={deleting === skill.name}
                            className="rounded-xl px-3 py-1.5 text-xs font-medium text-rose-500 hover:text-rose-400 disabled:opacity-50"
                          >
                            {deleting === skill.name ? "Deleting…" : "confirm delete"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(null)}
                            className={ghostButtonClass(isDark)}
                          >
                            cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(skill.name)}
                          className="rounded-xl px-3 py-1.5 text-xs font-medium text-rose-500/80 hover:text-rose-500"
                        >
                          delete
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {isEditingThis && (
                  <div className={`border-t px-4 py-3.5 ${isDark ? "border-white/10" : "border-zinc-200"}`}>
                    {renderForm(false)}
                  </div>
                )}
                {!isEditingThis && isOpen && (
                  <div className={`border-t px-4 py-3.5 ${isDark ? "border-white/10" : "border-zinc-200"}`}>
                    <pre
                      className={`whitespace-pre-wrap break-words text-xs leading-relaxed ${bodyTextClass(
                        isDark,
                      )}`}
                    >
                      {skill.body}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </PanelPage>
  );
}
