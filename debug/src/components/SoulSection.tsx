import { useCallback, useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { SparklesIcon } from "@hugeicons/core-free-icons";
import { panelCardClass, subtlePanelClass } from "./PanelPrimitives.js";

interface SoulState {
  content: string;
  isCustom: boolean;
}

export function SoulSection({ isDark }: { isDark: boolean }) {
  const [soul, setSoul] = useState<SoulState | null>(null);
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const label = isDark ? "text-zinc-100" : "text-zinc-900";
  const muted = isDark ? "text-zinc-500" : "text-zinc-400";
  const inputBg = isDark
    ? "bg-[#17171a] border-white/10 text-zinc-100"
    : "bg-zinc-50 border-zinc-200 text-zinc-900";

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/soul", { cache: "no-store" });
      if (!res.ok) throw new Error(`Soul fetch failed (${res.status})`);
      const json = (await res.json()) as SoulState;
      setSoul(json);
      setDraft(json.content);
      setDirty(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/soul", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft }),
      });
      const json = (await res.json()) as SoulState & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `Save failed (${res.status})`);
      setSoul(json);
      setDraft(json.content);
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    setResetting(true);
    setError(null);
    try {
      const res = await fetch("/api/soul", { method: "DELETE" });
      const json = (await res.json()) as SoulState & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `Reset failed (${res.status})`);
      setSoul(json);
      setDraft(json.content);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResetting(false);
    }
  }

  return (
    <section className={panelCardClass(isDark, "fade-in overflow-hidden")}>
      <div className="px-4 py-4 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span
            className={`h-10 w-10 rounded-xl inline-flex items-center justify-center shrink-0 ${
              isDark ? "bg-white/5 text-zinc-300" : "bg-zinc-100 text-zinc-700"
            }`}
          >
            <HugeiconsIcon icon={SparklesIcon} size={20} strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <div className={`text-sm font-medium ${label}`}>Soul</div>
            <div className={`text-xs mt-1 leading-relaxed max-w-3xl ${muted}`}>
              Personality and voice — how Boop talks to you, not what it can do. Saved to{" "}
              <span className="mono">soul.md</span>, which never gets committed.
            </div>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-2xl border px-2.5 py-1 text-xs mono ${
            isDark ? "border-white/10 bg-white/5 text-zinc-500" : "border-zinc-200 bg-white text-zinc-500"
          }`}
        >
          {soul === null ? "…" : soul.isCustom ? "customized" : "default"}
        </span>
      </div>

      <div className={`border-t px-4 py-4 ${isDark ? "border-white/10" : "border-zinc-200"}`}>
        {error && (
          <div className={subtlePanelClass(isDark, "mb-3 px-3 py-2 text-xs text-rose-500")}>{error}</div>
        )}
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setDirty(true);
          }}
          rows={12}
          disabled={soul === null}
          className={`w-full rounded-xl border px-3 py-2 text-xs mono leading-relaxed outline-none transition-colors focus:border-zinc-400 resize-y disabled:opacity-60 ${inputBg}`}
        />
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty || !draft.trim()}
            className={`rounded-xl px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
              isDark ? "bg-zinc-100 text-zinc-950 hover:bg-white" : "bg-zinc-950 text-white hover:bg-zinc-800"
            }`}
          >
            {saving ? "Saving…" : saved ? "Saved ✓" : "Save"}
          </button>
          {soul?.isCustom && (
            <button
              type="button"
              onClick={reset}
              disabled={resetting}
              className={`rounded-xl px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${muted} ${
                isDark ? "hover:text-zinc-100" : "hover:text-zinc-900"
              }`}
            >
              {resetting ? "Resetting…" : "Reset to default"}
            </button>
          )}
          {dirty && !saving && <span className={`text-xs ${muted}`}>Unsaved changes</span>}
        </div>
      </div>
    </section>
  );
}
