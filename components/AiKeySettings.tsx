"use client";

import { useCallback, useEffect, useState } from "react";
import { useArmedConfirm } from "./useArmedConfirm";

/**
 * Set the AI provider key from inside the app.
 *
 * The key otherwise lives in a host environment variable, which can only be
 * changed in a dashboard and only takes effect on the next build — so a wrong
 * value costs a redeploy to find out about and another to fix. Here the key is
 * authenticated against the provider before it is saved: you learn on the spot
 * whether it works, and a key that doesn't never lands.
 */

type Provider = "anthropic" | "openrouter";

type Check = {
  provider: Provider;
  configured: boolean;
  ok: boolean | null;
  source?: "stored" | "env";
  error?: string;
};

const META: Record<Provider, { name: string; prefix: string; keysUrl: string }> = {
  openrouter: {
    name: "OpenRouter",
    prefix: "sk-or-",
    keysUrl: "https://openrouter.ai/keys",
  },
  anthropic: {
    name: "Anthropic",
    prefix: "sk-ant-",
    keysUrl: "https://console.anthropic.com/settings/keys",
  },
};

const inputCls =
  "w-full rounded-lg border hairline bg-white px-3 py-2 text-sm outline-none placeholder:text-(--color-ink-faint) focus:border-(--color-clay)/50";

export default function AiKeySettings() {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [stored, setStored] = useState<Provider[]>([]);
  const [draft, setDraft] = useState<Record<Provider, string>>({
    openrouter: "",
    anthropic: "",
  });
  const [busy, setBusy] = useState<Provider | null>(null);
  const [note, setNote] = useState<{ provider: Provider; text: string; ok: boolean } | null>(
    null
  );
  const confirmRemove = useArmedConfirm();

  const refresh = useCallback(async () => {
    try {
      const [health, keys] = await Promise.all([
        fetch("/api/ai/health").then((r) => r.json()),
        fetch("/api/ai/key").then((r) => r.json()),
      ]);
      setChecks(health.providers ?? []);
      setStored(keys.stored ?? []);
    } catch {
      setChecks([]);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function save(provider: Provider) {
    setBusy(provider);
    setNote(null);
    try {
      const res = await fetch("/api/ai/key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, key: draft[provider] }),
      });
      const data = await res.json();
      if (!data.ok) {
        setNote({ provider, text: data.error ?? "That key didn't work.", ok: false });
      } else {
        setDraft((d) => ({ ...d, [provider]: "" }));
        setNote({ provider, text: `${META[provider].name} key verified and saved.`, ok: true });
        await refresh();
      }
    } catch {
      setNote({ provider, text: "Couldn't reach the server.", ok: false });
    } finally {
      setBusy(null);
    }
  }

  async function remove(provider: Provider) {
    setBusy(provider);
    setNote(null);
    try {
      await fetch("/api/ai/key", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  const checkFor = (p: Provider) => checks?.find((c) => c.provider === p);

  return (
    <>
      <p className="text-[11px] leading-relaxed text-(--color-ink-soft)">
        The AI features use the first key that works. A key saved here is
        checked against the provider before it is stored and takes effect
        immediately — no redeploy.
      </p>

      {(["openrouter", "anthropic"] as Provider[]).map((provider) => {
        const meta = META[provider];
        const check = checkFor(provider);
        const isStored = stored.includes(provider);
        const status = !check?.configured
          ? { label: "Not set", tone: "text-(--color-ink-faint)" }
          : check.ok
            ? { label: "Working", tone: "text-emerald-600" }
            : { label: "Rejected", tone: "text-red-600" };

        return (
          <div key={provider} className="rounded-xl border hairline p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold">{meta.name}</span>
              <span className="flex items-center gap-2">
                {check?.configured && (
                  <span className="font-display text-[9px] uppercase tracking-[0.14em] text-(--color-ink-faint)">
                    {check.source === "stored" ? "from app" : "from env"}
                  </span>
                )}
                <span className={`text-[11px] font-semibold ${status.tone}`}>
                  {checks === null ? "…" : status.label}
                </span>
              </span>
            </div>

            {check?.configured && !check.ok && check.error && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-red-600">
                {check.error}
              </p>
            )}

            <div className="mt-2 flex gap-1.5">
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                className={inputCls}
                placeholder={`${meta.prefix}…`}
                value={draft[provider]}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [provider]: e.target.value }))
                }
                onKeyDown={(e) => e.key === "Enter" && save(provider)}
              />
              <button
                onClick={() => save(provider)}
                disabled={busy === provider || !draft[provider].trim()}
                className="shrink-0 rounded-lg bg-(--color-clay) px-3 py-2 text-[13px] font-semibold text-(--color-paper) transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40"
              >
                {busy === provider ? "Checking…" : "Save"}
              </button>
            </div>

            {note?.provider === provider && (
              <p
                className={`mt-1.5 text-[11px] leading-relaxed ${
                  note.ok ? "text-emerald-600" : "text-red-600"
                }`}
              >
                {note.text}
              </p>
            )}

            <div className="mt-2 flex items-center justify-between gap-2">
              <a
                href={meta.keysUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-medium text-(--color-clay) hover:underline"
              >
                Get a key ↗
              </a>
              {isStored &&
                (confirmRemove.isArmed(provider) ? (
                  <button
                    onClick={() => {
                      confirmRemove.disarm();
                      remove(provider);
                    }}
                    className="rounded-md bg-red-50 px-2 py-1 text-[10px] font-bold text-red-600"
                  >
                    Remove?
                  </button>
                ) : (
                  <button
                    onClick={() => confirmRemove.arm(provider)}
                    className="text-[11px] font-medium text-(--color-ink-faint) transition-colors hover:text-red-500"
                  >
                    Remove saved key
                  </button>
                ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
