"use client";

import { useState } from "react";
import { Provider, Settings } from "@/lib/types";
import { SavedAccountInfo } from "@/lib/mailApi";
import { GoogleIcon, MicrosoftIcon, ProviderIcon } from "./brandIcons";
import { GearIcon } from "./ui";
import AiKeySettings from "./AiKeySettings";

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

function HostFields({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_88px] gap-2">
      <Field label="IMAP host">
        <input
          className={inputCls}
          placeholder="imap.example.com"
          value={settings.imapHost}
          onChange={(e) => onChange({ imapHost: e.target.value })}
        />
      </Field>
      <Field label="Port">
        <input
          className={inputCls}
          value={settings.imapPort}
          onChange={(e) => onChange({ imapPort: Number(e.target.value) || 993 })}
        />
      </Field>
      <Field label="SMTP host">
        <input
          className={inputCls}
          placeholder="smtp.example.com"
          value={settings.smtpHost}
          onChange={(e) => onChange({ smtpHost: e.target.value })}
        />
      </Field>
      <Field label="Port">
        <input
          className={inputCls}
          value={settings.smtpPort}
          onChange={(e) => onChange({ smtpPort: Number(e.target.value) || 465 })}
        />
      </Field>
    </div>
  );
}

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
  onConnectSaved,
  onDisconnect,
  onSaveAccount,
  onDeleteSavedAccount,
  onRenameAccount,
  onClose,
}: {
  settings: Settings;
  savedAccounts: SavedAccountInfo[];
  connectedAccounts: string[];
  connecting: boolean;
  connectError: string | null;
  onChange: (patch: Partial<Settings>) => void;
  onConnect: () => void;
  onConnectSaved: (id: string) => void;
  onDisconnect: (account?: string) => void;
  onSaveAccount: () => void;
  onDeleteSavedAccount: (id: string) => void;
  onRenameAccount: (account: SavedAccountInfo, label: string) => void;
  onClose: () => void;
}) {
  const connected = connectedAccounts.length > 0;
  const currentConnected = connectedAccounts.includes(settings.email);
  const [tab, setTab] = useState<"profile" | "account" | "ai" | "prefs">("account");
  // 0 = accounts home; 1–3 = the add-account wizard
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // removing a saved login is irreversible (encrypted password/token goes with
  // it), so ✕ arms a confirm instead of deleting outright
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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

  const startWizard = () => {
    onChange({ email: "", password: "" });
    setAdvancedOpen(false);
    setStep(1);
  };

  const finishSetup = (a: SavedAccountInfo) => {
    selectSaved(a);
    setAdvancedOpen(false);
    setStep(2);
  };

  const detailsReady =
    settings.email.trim().length > 3 &&
    settings.email.includes("@") &&
    (settings.password.trim().length > 0 || selectedSaved?.hasPassword) &&
    (settings.provider !== "custom" ||
      (settings.imapHost.trim() && settings.smtpHost.trim()));

  // the connect succeeded when the wizard's account shows up as connected
  const wizardDone = step === 3 && currentConnected && !connecting;

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
              ["ai", "AI"],
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
              <Field label="Signature (plain text, appended to sent mail)">
                <textarea
                  rows={2}
                  className={`${inputCls} resize-none`}
                  value={settings.signature}
                  onChange={(e) => onChange({ signature: e.target.value })}
                />
              </Field>
              <Field label="HTML signature (optional — write HTML for a rich sign-off)">
                <textarea
                  rows={4}
                  spellCheck={false}
                  placeholder={
                    '<strong>Jon Garcia</strong><br>\n<a href="https://sofilakes.com">Sofi Lakes</a> · (555) 010-0000'
                  }
                  className={`${inputCls} resize-none font-mono text-xs`}
                  value={settings.signatureHtml ?? ""}
                  onChange={(e) => onChange({ signatureHtml: e.target.value })}
                />
              </Field>
              {settings.signatureHtml?.trim() && (
                <div>
                  <p className="mb-1.5 font-display text-[9px] font-normal uppercase tracking-[0.18em] text-(--color-ink-faint)">
                    Preview
                  </p>
                  <div
                    className="email-body rounded-lg border hairline bg-white p-3 text-sm text-(--color-ink)"
                    // the user's own signature, shown back to them
                    dangerouslySetInnerHTML={{ __html: settings.signatureHtml }}
                  />
                  <p className="mt-1.5 text-[11px] text-(--color-ink-faint)">
                    Sent mail includes this as the HTML part; the plain-text
                    signature above is the fallback for text-only clients.
                  </p>
                </div>
              )}
            </>
          )}

          {tab === "account" && step === 0 && (
            /* ---------- ACCOUNTS HOME ---------- */
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

              {savedAccounts.length === 0 && localOnly.length === 0 && (
                <p className="rounded-lg bg-(--color-paper) px-3 py-3 text-[12px] leading-relaxed text-(--color-ink-soft)">
                  No email accounts yet — Tria is showing demo data. Add your
                  first account and your real inbox takes over.
                </p>
              )}

              {(savedAccounts.length > 0 || localOnly.length > 0) && (
                <Field label="Your accounts">
                  <div className="space-y-1">
                    {savedAccounts.map((a) => {
                      const isConnected = connectedAccounts.includes(a.email);
                      const oneClick = a.hasPassword || a.isOAuth;
                      return (
                        <div
                          key={a.id}
                          className="flex w-full items-center gap-2 rounded-lg border hairline px-3 py-2.5 text-xs"
                        >
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${
                              isConnected
                                ? "bg-(--color-sage)"
                                : "bg-(--color-ink-faint)/40"
                            }`}
                          />
                          <ProviderIcon
                            provider={a.provider}
                            className="h-4 w-4 shrink-0"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">
                              {a.email}
                            </span>
                            <span className="block font-display text-[8px] uppercase tracking-[0.14em] text-(--color-ink-faint)">
                              {providerPresets[a.provider].label}
                              {isConnected
                                ? " · connected"
                                : a.isOAuth
                                  ? " · signed in"
                                  : a.hasPassword
                                    ? " · saved login"
                                    : " · needs password"}
                            </span>
                          </span>
                          {isConnected ? (
                            <button
                              onClick={() => onDisconnect(a.email)}
                              className="shrink-0 rounded-md px-2 py-1 font-display text-[9px] font-semibold uppercase tracking-[0.12em] text-(--color-ink-faint) transition-colors hover:bg-red-50 hover:text-red-500"
                            >
                              Disconnect
                            </button>
                          ) : oneClick ? (
                            <button
                              onClick={() => onConnectSaved(a.id)}
                              disabled={connecting}
                              className="shrink-0 rounded-md bg-(--color-clay) px-2.5 py-1 font-display text-[9px] font-semibold uppercase tracking-[0.12em] text-white transition-transform hover:scale-[1.03] disabled:opacity-60"
                            >
                              {connecting ? "…" : "Connect"}
                            </button>
                          ) : (
                            <button
                              onClick={() => finishSetup(a)}
                              className="shrink-0 rounded-md border hairline px-2.5 py-1 font-display text-[9px] font-semibold uppercase tracking-[0.12em] text-(--color-ink-soft) transition-colors hover:border-(--color-clay)/50 hover:text-(--color-clay)"
                            >
                              Finish setup
                            </button>
                          )}
                          {renamingId === a.id ? (
                            <span
                              className="flex shrink-0 items-center gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                autoFocus
                                value={renameText}
                                placeholder={a.email}
                                onChange={(e) => setRenameText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    onRenameAccount(a, renameText);
                                    setRenamingId(null);
                                  }
                                  if (e.key === "Escape") setRenamingId(null);
                                }}
                                className="w-36 rounded-md border hairline px-2 py-1 text-xs outline-none focus:border-(--color-clay)/50"
                              />
                              <button
                                onClick={() => {
                                  onRenameAccount(a, renameText);
                                  setRenamingId(null);
                                }}
                                className="rounded-md bg-(--color-ink) px-2 py-1 font-display text-[9px] font-semibold uppercase tracking-[0.12em] text-(--color-paper)"
                              >
                                Save
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => {
                                setRenamingId(a.id);
                                setRenameText(a.label ?? "");
                              }}
                              title="Name this account"
                              className="shrink-0 rounded-md px-1.5 py-1 font-display text-[9px] font-semibold uppercase tracking-[0.12em] text-(--color-ink-faint) transition-colors hover:text-(--color-clay)"
                            >
                              Rename
                            </button>
                          )}
                          {confirmDeleteId === a.id ? (
                            <span className="flex shrink-0 items-center gap-1">
                              <button
                                onClick={() => {
                                  setConfirmDeleteId(null);
                                  onDeleteSavedAccount(a.id);
                                }}
                                className="rounded-md bg-red-500 px-2 py-1 font-display text-[9px] font-semibold uppercase tracking-[0.12em] text-white transition-transform hover:scale-[1.03]"
                              >
                                Remove
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="rounded-md border hairline px-2 py-1 font-display text-[9px] font-semibold uppercase tracking-[0.12em] text-(--color-ink-soft) transition-colors hover:border-(--color-ink-faint)"
                              >
                                Keep
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(a.id)}
                              title="Remove saved account"
                              className="shrink-0 rounded-md px-1 text-(--color-ink-faint) transition-colors hover:bg-red-50 hover:text-red-500"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {localOnly.map((a) => (
                      <div
                        key={a.id}
                        className="flex w-full items-center gap-2 rounded-lg border hairline px-3 py-2.5 text-xs"
                      >
                        <span className="h-2 w-2 shrink-0 rounded-full bg-(--color-ink-faint)/40" />
                        <ProviderIcon
                          provider={a.provider}
                          className="h-4 w-4 shrink-0"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {a.email}
                          </span>
                          <span className="block font-display text-[8px] uppercase tracking-[0.14em] text-(--color-ink-faint)">
                            {providerPresets[a.provider].label} · needs password
                          </span>
                        </span>
                        <button
                          onClick={() => {
                            selectLocal(a.id);
                            setStep(2);
                          }}
                          className="shrink-0 rounded-md border hairline px-2.5 py-1 font-display text-[9px] font-semibold uppercase tracking-[0.12em] text-(--color-ink-soft) transition-colors hover:border-(--color-clay)/50 hover:text-(--color-clay)"
                        >
                          Finish setup
                        </button>
                      </div>
                    ))}
                  </div>
                </Field>
              )}

              {connectError && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-[11px] leading-relaxed text-red-600">
                  {connectError}
                </p>
              )}

              <button
                onClick={startWizard}
                className="w-full rounded-lg bg-(--color-clay) px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm transition-transform hover:scale-[1.01] active:scale-[0.99]"
              >
                + Add an account
              </button>
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

          {tab === "account" && step > 0 && (
            /* ---------- ADD-ACCOUNT WIZARD ---------- */
            <>
              <div className="flex items-center gap-3">
                <button
                  onClick={() =>
                    setStep((s) => (s === 1 ? 0 : ((s - 1) as 0 | 1 | 2 | 3)))
                  }
                  className="inline-flex items-center gap-1 text-xs font-semibold text-(--color-ink-faint) transition-colors hover:text-(--color-ink)"
                >
                  ← Back
                </button>
                <span className="font-display text-[10px] font-medium uppercase tracking-[0.2em] text-(--color-ink-faint)">
                  Add an account
                </span>
                <span className="ml-auto flex items-center gap-1.5">
                  {([1, 2, 3] as const).map((s) => (
                    <span
                      key={s}
                      className={`h-1.5 rounded-full transition-all ${
                        s === step
                          ? "w-5 bg-(--color-clay)"
                          : s < step
                            ? "w-1.5 bg-(--color-clay)/50"
                            : "w-1.5 bg-(--color-ink-faint)/25"
                      }`}
                    />
                  ))}
                </span>
              </div>

              {step === 1 && (
                /* ----- STEP 1 · choose how you sign in ----- */
                <>
                  <h3 className="font-display text-lg font-light leading-snug">
                    What email do you want to add?
                  </h3>
                  <Field label="Fastest — sign in, no password needed">
                    <div className="grid grid-cols-2 gap-1.5">
                      {(
                        [
                          ["google", "Google / Gmail", GoogleIcon],
                          ["microsoft", "Microsoft", MicrosoftIcon],
                        ] as const
                      ).map(([p, label, Icon]) => (
                        <a
                          key={p}
                          href={`/api/oauth/${p}/start`}
                          className="flex items-center justify-center gap-2 rounded-lg border hairline px-3 py-2.5 text-xs font-semibold text-(--color-ink-soft) transition-colors hover:border-(--color-clay)/50 hover:text-(--color-clay)"
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          Sign in with {label}
                        </a>
                      ))}
                    </div>
                  </Field>
                  <Field label="Or pick your provider — connects with an app password">
                    <div className="grid grid-cols-2 gap-1.5">
                      {(Object.keys(providerPresets) as Provider[]).map((p) => (
                        <button
                          key={p}
                          onClick={() => {
                            setProvider(p);
                            setStep(2);
                          }}
                          className="flex items-center gap-2.5 rounded-lg border hairline px-3 py-2.5 text-left text-xs font-semibold text-(--color-ink-soft) transition-colors hover:border-(--color-clay)/50 hover:text-(--color-clay)"
                        >
                          <ProviderIcon provider={p} className="h-4 w-4 shrink-0" />
                          <span className="min-w-0">
                            {providerPresets[p].label}
                            {p === "custom" && (
                              <span className="block font-display text-[8px] font-normal uppercase tracking-[0.14em] text-(--color-ink-faint)">
                                any IMAP server
                              </span>
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  </Field>
                  <p className="text-[11px] leading-relaxed text-(--color-ink-faint)">
                    Gmail and Microsoft work best with sign-in — password logins
                    are increasingly blocked outright.
                  </p>
                </>
              )}

              {step === 2 && (
                /* ----- STEP 2 · enter details ----- */
                <>
                  <h3 className="font-display text-lg font-light leading-snug">
                    Sign in to {providerPresets[settings.provider].label}
                  </h3>
                  {providerPresets[settings.provider].note && (
                    <p className="rounded-lg bg-(--color-paper) px-3 py-2 text-[11px] leading-relaxed text-(--color-ink-soft)">
                      {providerPresets[settings.provider].note}
                    </p>
                  )}
                  <Field label="Email address">
                    <input
                      className={inputCls}
                      autoFocus
                      placeholder="you@example.com"
                      value={settings.email}
                      onChange={(e) => onChange({ email: e.target.value })}
                    />
                  </Field>
                  <Field label="App password">
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
                        {providerPresets[settings.provider].label} app passwords
                        are 16 characters. This looks like your normal account
                        password — {providerPresets[settings.provider].label}{" "}
                        will reject it.
                      </p>
                    )}
                  {selectedSaved?.hasPassword && !settings.password && (
                    <p className="text-[11px] leading-relaxed text-(--color-sage)">
                      This account has a saved login — leave the password blank
                      and the stored one is used.
                    </p>
                  )}

                  {settings.provider === "custom" ? (
                    <HostFields settings={settings} onChange={onChange} />
                  ) : (
                    <>
                      <button
                        onClick={() => setAdvancedOpen((v) => !v)}
                        className="text-[11px] font-medium text-(--color-ink-faint) transition-colors hover:text-(--color-ink)"
                      >
                        {advancedOpen ? "▾" : "▸"} Advanced — server settings
                      </button>
                      {advancedOpen && (
                        <HostFields settings={settings} onChange={onChange} />
                      )}
                    </>
                  )}

                  <button
                    onClick={() => setStep(3)}
                    disabled={!detailsReady}
                    className="w-full rounded-lg bg-(--color-clay) px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40"
                  >
                    Continue →
                  </button>
                  <button
                    onClick={() => {
                      onSaveAccount();
                      setStep(0);
                    }}
                    disabled={!settings.email.trim()}
                    className="w-full text-[11px] font-medium text-(--color-ink-faint) transition-colors hover:text-(--color-ink) disabled:opacity-40"
                  >
                    Save for later without connecting
                  </button>
                </>
              )}

              {step === 3 && !wizardDone && (
                /* ----- STEP 3 · review + connect ----- */
                <>
                  <h3 className="font-display text-lg font-light leading-snug">
                    Ready to connect
                  </h3>
                  <div className="space-y-2 rounded-lg border hairline bg-(--color-paper) px-3 py-3 text-xs">
                    <div className="flex justify-between gap-3">
                      <span className="text-(--color-ink-faint)">Account</span>
                      <span className="min-w-0 truncate font-medium">
                        {settings.email}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-(--color-ink-faint)">Provider</span>
                      <span className="font-medium">
                        {providerPresets[settings.provider].label}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-(--color-ink-faint)">Password</span>
                      <span className="font-medium">
                        {settings.password
                          ? "•".repeat(8)
                          : selectedSaved?.hasPassword
                            ? "using saved login"
                            : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-(--color-ink-faint)">Servers</span>
                      <span className="min-w-0 truncate font-medium">
                        {settings.imapHost} · {settings.smtpHost}
                      </span>
                    </div>
                  </div>

                  {connectError && (
                    <p className="rounded-lg bg-red-50 px-3 py-2 text-[11px] leading-relaxed text-red-600">
                      {connectError}
                    </p>
                  )}

                  <button
                    onClick={onConnect}
                    disabled={connecting}
                    className="w-full rounded-lg bg-(--color-clay) px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
                  >
                    {connecting ? "Connecting…" : "Connect account ⚡"}
                  </button>
                </>
              )}

              {wizardDone && (
                /* ----- STEP 3 · success ----- */
                <div className="space-y-4 pt-2 text-center">
                  <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-(--color-sage)/15 text-xl text-(--color-sage)">
                    ✓
                  </span>
                  <div>
                    <p className="text-sm font-semibold">
                      {settings.email} is live
                    </p>
                    <p className="mt-1 text-[12px] leading-relaxed text-(--color-ink-soft)">
                      Your inbox is loading in the Mail pane. The login is saved
                      (encrypted), so next time it reconnects automatically.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={startWizard}
                      className="flex-1 rounded-lg border hairline px-3 py-2 text-[13px] font-semibold text-(--color-ink-soft) transition-colors hover:border-(--color-ink-faint)"
                    >
                      + Add another
                    </button>
                    <button
                      onClick={() => setStep(0)}
                      className="flex-1 rounded-lg bg-(--color-ink) px-3 py-2 text-[13px] font-semibold text-(--color-paper) transition-transform hover:scale-[1.01]"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {tab === "ai" && <AiKeySettings />}

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
              <Field label="Appearance">
                <div className="flex gap-1.5">
                  {(
                    [
                      ["light", "Light"],
                      ["dark", "Dark"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => onChange({ theme: key })}
                      className={`flex-1 rounded-lg border px-2 py-1.5 font-display text-[10px] font-medium uppercase tracking-[0.1em] transition-colors ${
                        (settings.theme ?? "dark") === key
                          ? "border-(--color-clay) bg-(--color-clay-soft) text-(--color-clay)"
                          : "hairline text-(--color-ink-soft) hover:border-(--color-ink-faint)"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
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
            className="w-full rounded-lg bg-(--color-ink) px-4 py-2.5 text-[13px] font-semibold text-(--color-paper) transition-transform hover:scale-[1.01] active:scale-[0.99]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
