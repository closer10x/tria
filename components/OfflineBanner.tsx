"use client";

/**
 * The one place the app admits it is offline.
 *
 * Without it the symptoms are indistinguishable from bugs: mail that won't
 * refresh, actions that "work" and then revert, an error toast per tap. This
 * says what is happening and what will happen when the connection returns.
 */
export default function OfflineBanner({
  offline,
  queued,
  syncing,
}: {
  offline: boolean;
  /** Items waiting in the outbox. */
  queued: number;
  /** A reconnect replay is in flight. */
  syncing: boolean;
}) {
  if (!offline && !syncing && queued === 0) return null;

  const tone = offline
    ? "border-(--color-gold)/40 bg-(--color-gold)/15 text-(--color-gold)"
    : "border-(--color-sage)/40 bg-(--color-sage)/15 text-(--color-sage)";

  const message = offline
    ? queued > 0
      ? `Offline — showing your last synced mail. ${queued} change${
          queued === 1 ? "" : "s"
        } will send when you're back.`
      : "Offline — showing your last synced mail."
    : syncing
      ? "Back online — sending what you did offline…"
      : `${queued} change${queued === 1 ? "" : "s"} still waiting to send.`;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`mx-4 mb-1 flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 font-display text-[10px] font-medium uppercase tracking-[0.18em] ${tone}`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full bg-current ${
          syncing ? "animate-pulse" : ""
        }`}
      />
      <span className="normal-case tracking-normal">{message}</span>
    </div>
  );
}
