"use client";

import { useState } from "react";
import { Provider, Settings } from "@/lib/types";
import { SavedAccountInfo } from "@/lib/mailApi";
import { GearIcon, MailIcon } from "./ui";

const providerPresets: Record<
  Provider,
  {
    label: string;
    imapHost: string;
    imapPort: number;
    smtpHost: string;
    smtpPort: number;
    note?: string;
  }
> = {
  gmail: {
    label: "Gmail",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    note: "Gmail needs an app password (Google Account → Security → 2-Step Verification → App passwords).",
  },
  outlook: {
    label: "Outlook.com",
    imapHost: "outlook.office365.com",
    imapPort: 993,
    smtpHost: "smtp-mail.outlook.com",
    smtpPort: 587,
    note: "Personal @outlook.com / @hotmail.com accounts. For a work or custom-domain address, pick Microsoft 365 instead.",
  },
  m365: {
    label: "Microsoft 365",
    imapHost: "outlook.office365.com",
    imapPort: 993,
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    note: "Work/custom-domain Microsoft 365 mail. IMAP and Authenticated SMTP must be enabled for the mailbox (admin.microsoft.com → Users → Mail → Manage email apps), and Microsoft blocks password logins entirely when MFA is on.",
  },
  godaddy: {
    label: "GoDaddy",
    imapHost: "imap.secureserver.net",
    imapPort: 993,
    smtpHost: "smtpout.secureserver.net",
    smtpPort: 465,
    note: "GoDaddy Workspace email. If your GoDaddy mail runs on Microsoft 365, pick Outlook instead.",
  },
  yahoo: {
    label: "Yahoo",
    imapHost: "imap.mail.yahoo.com",
    imapPort: 993,
    smtpHost: "smtp.mail.yahoo.com",
    smtpPort: 465,
    note: "Yahoo needs an app password (Account Security → Generate app password).",
  },
  icloud: {
    label: "iCloud",
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    smtpHost: "smtp.mail.me.com",
    smtpPort: 587,
    note: "iCloud needs an app-specific password from appleid.apple.com.",
  },
  custom: {
    label: "Custom",
    imapHost: "",
    imapPort: 993,
    smtpHost: "",
    smtpPort: 465,
  },
};

const timezones = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
  "UTC",
];

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block font-display text-[9px] font-medium uppercase tracking-[0.18em] text-(--color-ink-faint)">
        {label}
      </span>
      {children}
    </label>
  );
}

/** Providers whose IMAP only accepts a 16-character app password. */
const appPasswordProviders = new Set<Provider>(["gmail", "yahoo", "icloud"]);

const inputCls =
  "w-full rounded-lg border hairline bg-white px-3 py-2 text-sm outline-none placeholder:text-(--color-ink-faint) focus:border-(--color-clay)/50";

export default function SettingsModal({
  settings,
  savedAccounts,
  connectedAccounts,
  connecting,
  connectError,
  onChange,
  onConnect,
  onDisconnect,
  onSaveAccount,
  onDeleteSavedAccount,
  onClose,
}: {
  settings: Settings;
  savedAccounts: SavedAccountInfo[];
  connectedAccounts: string[];
  connecting: boolean;
  connectError: string | null;
  onChange: (patch: Partial<Settings>) => void;
  onConnect: () => void;
  onDisconnect: (account?: string) => void;
  onSaveAccount: () => void;
  onDeleteSavedAccount: (id: string) => void;
  onClose: () => void;
}) {
  const connected = connectedAccounts.length > 0;
  const currentConnected = connectedAccounts.includes(settings.email);
  const [tab, setTab] = useState<"profile" | "account" | "prefs">("account");

  const setProvider = (p: Provider) => {
    const { label: _l, note: _n, ...hosts } = providerPresets[p];
    onChange({ provider: p, ...hosts });
  };

  // server-saved accounts first, then any local-only leftovers
  const savedEmails = new Set(savedAccounts.map((a) => a.email));
  const localOnly = settings.accounts.filter((a) => !savedEmails.has(a.email));
  const selectedSaved = savedAccounts.find((a) => a.email === settings.email);

  const selectSaved = (a: SavedAccountInfo) => {
    onChange({
      email: a.email,
      provider: a.provider,
      imapHost: a.imapHost,
      imapPort: a.imapPort,
      smtpHost: a.smtpHost,
      smtpPort: a.smtpPort,
      password: "",
    });
  };

  const selectLocal = (id: string) => {
    const acc = settings.accounts.find((a) => a.id === id);
    if (!acc) return;
    const { label: _l, note: _n, ...hosts } = providerPresets[acc.provider];
    onChange({ email: acc.email, provider: acc.provider, ...hosts, password: "" });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rise-in flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div className="pane-head flex h-14 shrink-0 items-center gap-3 px-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/5 text-(--color-clay)">
            <GearIcon />
          </span>
          <h2 className="font-display text-[16px] font-light uppercase tracking-[0.32em] text-white">
            Settings
          </h2>
          <button
            onClick={onClose}
            className="ml-auto rounded-md p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="flex gap-5 border-b hairline px-5 pt-3">
          {(
            [
              ["profile", "Profile"],
              ["account", "Email Account"],
              ["prefs", "Preferences"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`border-b-2 pb-2 font-display text-[10px] font-medium uppercase tracking-[0.16em] transition-colors ${
                tab === key
                  ? "border-(--color-clay) text-(--color-ink)"
                  : "border-transparent text-(--color-ink-faint) hover:text-(--color-ink-soft)"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="nice-scroll min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {tab === "profile" && (
            <>
              <Field label="Full name">
                <input
                  className={inputCls}
                  value={settings.name}
                  onChange={(e) => onChange({ name: e.target.value })}
                />
              </Field>
              <Field label="Email address">
                <input
                  className={inputCls}
                  value={settings.email}
                  onChange={(e) => onChange({ email: e.target.value })}
                />
              </Field>
              <Field label="Signature (appended to sent mail)">
                <textarea
                  rows={3}
                  className={`${inputCls} resize-none`}
                  value={settings.signature}
                  onChange={(e) => onChange({ signature: e.target.value })}
                />
              </Field>
            </>
          )}

          {tab === "account" && (
            <>
              <div className="flex items-center justify-between rounded-lg border hairline bg-(--color-paper) px-3 py-2.5">
                <span className="text-xs font-medium text-(--color-ink-soft)">
                  Status
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 font-display text-[10px] font-semibold uppercase tracking-[0.14em] ${
                    connected ? "text-(--color-sage)" : "text-(--color-ink-faint)"
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      connected ? "bg-(--color-sage)" : "bg-(--color-ink-faint)"
                    }`}
                  />
                  {connected
                    ? connectedAccounts.length > 1
                      ? `Live — ${connectedAccounts.length} accounts`
                      : "Live — connected"
                    : "Demo data"}
                </span>
              </div>

              {connectedAccounts.length > 0 && (
                <Field label="Connected accounts">
                  <div className="space-y-1">
                    {connectedAccounts.map((a) => (
                      <div
                        key={a}
                        className="flex w-full items-center gap-2 rounded-lg border hairline px-3 py-2 text-xs"
                      >
                        <span className="h-2 w-2 shrink-0 rounded-full bg-(--color-sage)" />
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {a}
                        </span>
                        <button
                          onClick={() => onDisconnect(a)}
                          className="shrink-0 rounded-md px-1.5 py-0.5 font-display text-[9px] font-semibold uppercase tracking-[0.12em] text-(--color-ink-faint) transition-colors hover:bg-red-50 hover:text-red-500"
                        >
                          Disconnect
                        </button>
                      </div>
                    ))}
                  </div>
                </Field>
              )}

              {(savedAccounts.length > 0 || localOnly.length > 0) && (
                <Field label="Your accounts">
                  <div className="space-y-1">
                    {savedAccounts.map((a) => (
                      <div
                        key={a.id}
                        className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                          settings.email === a.email
                            ? "border-(--color-clay) bg-(--color-clay-soft)/40"
                            : "hairline hover:border-(--color-ink-faint)"
                        }`}
                      >
                        <button
                          onClick={() => selectSaved(a)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <MailIcon className="h-3.5 w-3.5 shrink-0 text-(--color-ink-faint)" />
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {a.email}
                          </span>
                          {a.isOAuth ? (
                            <span className="shrink-0 rounded-full bg-(--color-clay-soft) px-1.5 py-0.5 font-display text-[8px] font-semibold uppercase tracking-[0.12em] text-(--color-clay)">
                              Signed in
                            </span>
                          ) : (
                            a.hasPassword && (
                              <span className="shrink-0 rounded-full bg-(--color-sage)/15 px-1.5 py-0.5 font-display text-[8px] font-semibold uppercase tracking-[0.12em] text-(--color-sage)">
                                Saved login
                              </span>
                            )
                          )}
                          <span className="shrink-0 font-display text-[9px] uppercase tracking-[0.14em] text-(--color-ink-faint)">
                            {providerPresets[a.provider].label}
                          </span>
                        </button>
                        <button
                          onClick={() => onDeleteSavedAccount(a.id)}
                          title="Remove saved account"
                          className="shrink-0 rounded-md px-1 text-(--color-ink-faint) transition-colors hover:bg-red-50 hover:text-red-500"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    {localOnly.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => selectLocal(a.id)}
                        className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                          settings.email === a.email
                            ? "border-(--color-clay) bg-(--color-clay-soft)/40"
                            : "hairline hover:border-(--color-ink-faint)"
                        }`}
                      >
                        <MailIcon className="h-3.5 w-3.5 text-(--color-ink-faint)" />
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {a.email}
                        </span>
                        <span className="font-display text-[9px] uppercase tracking-[0.14em] text-(--color-ink-faint)">
                          {providerPresets[a.provider].label}
                        </span>
                      </button>
                    ))}
                  </div>
                </Field>
              )}

              <Field label="Sign in — no password needed">
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      ["microsoft", "Microsoft"],
                      ["google", "Google"],
                    ] as const
                  ).map(([p, label]) => (
                    <a
                      key={p}
                      href={`/api/oauth/${p}/start`}
                      className="flex items-center justify-center gap-2 rounded-lg border hairline px-3 py-2 text-xs font-semibold text-(--color-ink-soft) transition-colors hover:border-(--color-clay)/50 hover:text-(--color-clay)"
                    >
                      Sign in with {label}
                    </a>
                  ))}
                </div>
              </Field>
              <p className="text-[11px] leading-relaxed text-(--color-ink-faint)">
                Microsoft 365 and Google increasingly block password logins
                outright — signing in is the reliable route.
              </p>

              <Field label="Or connect with a password">
                <div className="grid grid-cols-3 gap-1.5">
                  {(Object.keys(providerPresets) as Provider[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => setProvider(p)}
                      className={`rounded-lg border px-2 py-1.5 font-display text-[10px] font-medium uppercase tracking-[0.1em] transition-colors ${
                        settings.provider === p
                          ? "border-(--color-clay) bg-(--color-clay-soft) text-(--color-clay)"
                          : "hairline text-(--color-ink-soft) hover:border-(--color-ink-faint)"
                      }`}
                    >
                      {providerPresets[p].label}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Email / username">
                <input
                  className={inputCls}
                  value={settings.email}
                  onChange={(e) => onChange({ email: e.target.value })}
                />
              </Field>
              <Field label="Password / app password">
                <input
                  type="password"
                  className={inputCls}
                  placeholder={
                    selectedSaved?.hasPassword
                      ? "Saved — leave blank to use stored login"
                      : "••••••••••••"
                  }
                  value={settings.password}
                  onChange={(e) => onChange({ password: e.target.value })}
                />
              </Field>
              {appPasswordProviders.has(settings.provider) &&
                settings.password.length > 0 &&
                settings.password.replace(/\s+/g, "").length !== 16 && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
                    {providerPresets[settings.provider].label} app passwords are
                    16 characters. This looks like your normal account password —
                    {providerPresets[settings.provider].label} will reject it.
                  </p>
                )}
              {selectedSaved?.hasPassword && !settings.password && (
                <p className="text-[11px] leading-relaxed text-(--color-sage)">
                  This account has a saved login — hit Connect and the stored
                  password is used automatically.
                </p>
              )}
              {providerPresets[settings.provider].note && (
                <p className="text-[11px] leading-relaxed text-(--color-ink-faint)">
                  {providerPresets[settings.provider].note}
                </p>
              )}
              <button
                onClick={onSaveAccount}
                className="w-full rounded-lg border border-dashed hairline px-3 py-2 text-xs font-medium text-(--color-ink-soft) transition-colors hover:border-(--color-clay)/50 hover:text-(--color-clay)"
              >
                + Save to my accounts
              </button>

              <div className="grid grid-cols-[1fr_88px] gap-2">
                <Field label="IMAP host">
                  <input
                    className={inputCls}
                    value={settings.imapHost}
                    onChange={(e) => onChange({ imapHost: e.target.value })}
                  />
                </Field>
                <Field label="Port">
                  <input
                    className={inputCls}
                    value={settings.imapPort}
                    onChange={(e) =>
                      onChange({ imapPort: Number(e.target.value) || 993 })
                    }
                  />
                </Field>
                <Field label="SMTP host">
                  <input
                    className={inputCls}
                    value={settings.smtpHost}
                    onChange={(e) => onChange({ smtpHost: e.target.value })}
                  />
                </Field>
                <Field label="Port">
                  <input
                    className={inputCls}
                    value={settings.smtpPort}
                    onChange={(e) =>
                      onChange({ smtpPort: Number(e.target.value) || 465 })
                    }
                  />
                </Field>
              </div>

              {connectError && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-[11px] leading-relaxed text-red-600">
                  {connectError}
                </p>
              )}

              {!currentConnected ? (
                <button
                  onClick={onConnect}
                  disabled={connecting}
                  className="w-full rounded-lg bg-(--color-clay) px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
                >
                  {connecting
                    ? "Connecting…"
                    : connected
                      ? "+ Connect this account too"
                      : "Connect account"}
                </button>
              ) : (
                <button
                  onClick={() => onDisconnect(settings.email)}
                  className="w-full rounded-lg border hairline px-4 py-2.5 text-[13px] font-semibold text-(--color-ink-soft) transition-colors hover:border-(--color-ink-faint)"
                >
                  Disconnect {settings.email}
                </button>
              )}
              {connected && (
                <button
                  onClick={() => onDisconnect()}
                  className="w-full rounded-lg border border-dashed hairline px-4 py-2 text-xs font-medium text-(--color-ink-faint) transition-colors hover:border-red-300 hover:text-red-500"
                >
                  Disconnect all — back to demo data
                </button>
              )}
            </>
          )}

          {tab === "prefs" && (
            <>
              <Field label="Timezone">
                <select
                  className={inputCls}
                  value={settings.timezone}
                  onChange={(e) => onChange({ timezone: e.target.value })}
                >
                  {timezones.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Time format">
                <div className="flex gap-1.5">
                  {(["12h", "24h"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => onChange({ timeFormat: f })}
                      className={`flex-1 rounded-lg border px-2 py-1.5 font-display text-[10px] font-medium uppercase tracking-[0.1em] transition-colors ${
                        settings.timeFormat === f
                          ? "border-(--color-clay) bg-(--color-clay-soft) text-(--color-clay)"
                          : "hairline text-(--color-ink-soft) hover:border-(--color-ink-faint)"
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Snooze — later today">
                <input
                  className={inputCls}
                  value={settings.snoozeTimes.laterToday}
                  onChange={(e) =>
                    onChange({
                      snoozeTimes: { ...settings.snoozeTimes, laterToday: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Snooze — tomorrow">
                <input
                  className={inputCls}
                  value={settings.snoozeTimes.tomorrow}
                  onChange={(e) =>
                    onChange({
                      snoozeTimes: { ...settings.snoozeTimes, tomorrow: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Snooze — next week">
                <input
                  className={inputCls}
                  value={settings.snoozeTimes.nextWeek}
                  onChange={(e) =>
                    onChange({
                      snoozeTimes: { ...settings.snoozeTimes, nextWeek: e.target.value },
                    })
                  }
                />
              </Field>
            </>
          )}
        </div>

        <div className="border-t hairline p-4">
          <button
            onClick={onClose}
            className="w-full rounded-lg bg-(--color-ink) px-4 py-2.5 text-[13px] font-semibold text-white transition-transform hover:scale-[1.01] active:scale-[0.99]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
