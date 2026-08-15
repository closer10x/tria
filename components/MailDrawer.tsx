"use client";

import { useEffect } from "react";
import { Folder } from "@/lib/types";
import { ArchiveIcon, ClockIcon, GearIcon, MailIcon, PenIcon, TrashIcon } from "./ui";

/** Sent has no icon in ui.tsx yet — a small paper plane to match the set. */
function SendGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 2L2 6.8l5.2 2L9.2 14 14 2z" />
      <path d="M7.2 8.8L14 2" />
    </svg>
  );
}
function InboxGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M2 9.5l1.6-5.2A1 1 0 0 1 4.6 3.5h6.8a1 1 0 0 1 1 .8L14 9.5" />
      <path d="M2 9.5h3.5l.7 1.5h3.6l.7-1.5H14v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-3z" />
    </svg>
  );
}

const FOLDER_ICON: Record<Folder, (p: { className?: string }) => React.ReactElement> = {
  inbox: InboxGlyph,
  snoozed: ClockIcon,
  drafts: PenIcon,
  sent: SendGlyph,
  archive: ArchiveIcon,
  trash: TrashIcon,
};

/**
 * Mobile-only slide-in menu for the Mail pane. Consolidates what the desktop
 * layout shows as chip and tab rows — folders, the account filter, and
 * settings — behind a burger button, freeing the phone screen for mail.
 */

export type DrawerFolder = { key: Folder; label: string };

export default function MailDrawer({
  open,
  onClose,
  folders,
  folder,
  folderCount,
  onSelectFolder,
  accounts,
  accountLabel,
  accountColor,
  accountUnread,
  activeAccount,
  onSelectAccount,
  onOpenSettings,
  live,
  userName,
}: {
  open: boolean;
  onClose: () => void;
  folders: DrawerFolder[];
  folder: Folder;
  folderCount: (f: Folder) => number;
  onSelectFolder: (f: Folder) => void;
  accounts: string[];
  accountLabel: (email: string) => string;
  accountColor: (email: string) => string;
  accountUnread: (email: string) => number;
  activeAccount: string; // "all" or an account email
  onSelectAccount: (account: string) => void;
  onOpenSettings: () => void;
  /** Shown in the footer — the top bar that used to carry these is hidden on mobile. */
  live?: boolean;
  userName?: string;
}) {
  // Escape closes; lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const sectionCls =
    "mb-1.5 mt-4 px-1 font-display text-[9px] font-medium uppercase tracking-[0.2em] text-(--color-ink-faint)";

  return (
    <div
      className={`fixed inset-0 z-50 lg:hidden ${open ? "" : "pointer-events-none"}`}
      aria-hidden={!open}
    >
      {/* scrim */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />
      {/* panel */}
      <aside
        role="dialog"
        aria-label="Mail menu"
        className={`absolute inset-y-0 left-0 flex w-[82vw] max-w-xs flex-col bg-(--color-panel) shadow-2xl transition-transform duration-200 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="pane-head flex h-14 shrink-0 items-center gap-3 px-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/5 text-(--color-clay)">
            <MailIcon />
          </span>
          <h2 className="font-display text-[16px] font-light uppercase tracking-[0.32em] text-white">
            Mail
          </h2>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="ml-auto rounded-md p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="nice-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <p className={sectionCls}>Folders</p>
          <div className="space-y-0.5">
            {folders.map((f) => {
              const active = folder === f.key;
              const n = folderCount(f.key);
              const Icon = FOLDER_ICON[f.key];
              return (
                <button
                  key={f.key}
                  onClick={() => {
                    onSelectFolder(f.key);
                    onClose();
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                    active
                      ? "bg-(--color-clay-soft) font-semibold text-(--color-clay)"
                      : "text-(--color-ink-soft) hover:bg-(--color-paper)"
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      active ? "text-(--color-clay)/70" : "text-(--color-ink-faint)/70"
                    }`}
                  />
                  <span className="min-w-0 flex-1">{f.label}</span>
                  {n > 0 && (
                    <span
                      className={`font-display text-[10px] ${
                        active ? "text-(--color-clay)" : "text-(--color-ink-faint)"
                      }`}
                    >
                      {n}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {accounts.length > 1 && (
            <>
              <p className={sectionCls}>Accounts</p>
              <div className="space-y-0.5">
                <button
                  onClick={() => {
                    onSelectAccount("all");
                    onClose();
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                    activeAccount === "all"
                      ? "bg-(--color-clay-soft) font-semibold text-(--color-clay)"
                      : "text-(--color-ink-soft) hover:bg-(--color-paper)"
                  }`}
                >
                  <span className="flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-full border border-current" />
                  All inboxes
                </button>
                {accounts.map((a) => {
                  const active = activeAccount === a;
                  const unread = accountUnread(a);
                  return (
                    <button
                      key={a}
                      onClick={() => {
                        onSelectAccount(a);
                        onClose();
                      }}
                      title={a}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                        active
                          ? "bg-(--color-clay-soft) font-semibold text-(--color-clay)"
                          : "text-(--color-ink-soft) hover:bg-(--color-paper)"
                      }`}
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: accountColor(a) }}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {accountLabel(a)}
                      </span>
                      {unread > 0 && (
                        <span
                          className={`font-display text-[10px] ${
                            active ? "text-(--color-clay)" : "text-(--color-ink-faint)"
                          }`}
                        >
                          {unread}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="shrink-0 border-t hairline p-3">
          {(userName || live !== undefined) && (
            <div className="mb-1 flex items-center gap-2 px-3 py-1.5">
              {userName && (
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-(--color-ink-soft)">
                  {userName}
                </span>
              )}
              <span
                className={`ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 font-display text-[9px] font-medium uppercase tracking-[0.18em] ${
                  live
                    ? "border-(--color-sage)/40 bg-(--color-sage)/15 text-(--color-sage)"
                    : "hairline text-(--color-ink-faint)"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    live ? "bg-(--color-sage)" : "bg-(--color-ink-faint)"
                  }`}
                />
                {live ? "Live" : "Offline"}
              </span>
            </div>
          )}
          <button
            onClick={() => {
              onClose();
              onOpenSettings();
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-(--color-ink-soft) transition-colors hover:bg-(--color-paper)"
          >
            <GearIcon className="h-4 w-4 text-(--color-ink-faint)" />
            Settings
          </button>
        </div>
      </aside>
    </div>
  );
}
