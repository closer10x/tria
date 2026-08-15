import { TaskPriority } from "@/lib/types";

export function Avatar({
  initials,
  hue,
  size = "md",
}: {
  initials: string;
  hue: string;
  size?: "sm" | "md";
}) {
  const s = size === "sm" ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-xs";
  return (
    <div
      className={`${s} ${hue} flex shrink-0 items-center justify-center rounded-full font-semibold tracking-wide`}
    >
      {initials}
    </div>
  );
}

export function Tag({ label }: { label: string }) {
  return (
    <span className="font-display text-[9px] font-normal uppercase tracking-[0.18em] text-(--color-ink-faint)">
      {label}
    </span>
  );
}

const prioStyles: Record<TaskPriority, { dot: string; text: string; label: string }> = {
  high: { dot: "bg-(--color-clay)", text: "text-(--color-clay)", label: "High" },
  medium: { dot: "bg-(--color-gold)", text: "text-(--color-gold)", label: "Medium" },
  low: { dot: "bg-(--color-ink-faint)", text: "text-(--color-ink-faint)", label: "Low" },
};

export function PriorityPill({ p }: { p: TaskPriority }) {
  const s = prioStyles[p];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium ${s.text} border hairline`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

export function PaneHeader({
  icon,
  title,
  count,
  tint: _tint = "clay",
  children,
}: {
  icon?: React.ReactNode;
  title?: string;
  count?: string;
  tint?: "clay" | "gold" | "sage" | "ink";
  children?: React.ReactNode;
}) {
  return (
    <div className="pane-head flex h-14 shrink-0 items-center gap-3 rounded-t-xl px-4">
      {children ?? (
        <>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/5 text-(--color-clay)">
            {icon}
          </span>
          <h2 className="font-display text-[16px] font-light uppercase tracking-[0.32em] text-white">
            {title}
          </h2>
          {count && (
            <span className="ml-auto rounded-full border border-white/15 bg-white/5 px-2.5 py-1 font-display text-[10px] font-normal uppercase tracking-[0.18em] text-white/70">
              {count}
            </span>
          )}
        </>
      )}
    </div>
  );
}

export function MailIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className={`h-4 w-4 ${className}`}
    >
      <rect x="1.5" y="3" width="13" height="10" rx="2" />
      <path d="M2 4.5l6 4.5 6-4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ReplyIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 ${className}`}>
      <path d="M6.5 3.5L2.5 7l4 3.5" />
      <path d="M2.5 7H9a4.5 4.5 0 0 1 4.5 4.5v1" />
    </svg>
  );
}

export function ArchiveIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 ${className}`}>
      <rect x="1.5" y="2.5" width="13" height="3.5" rx="1" />
      <path d="M3 6v6a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 12V6" />
      <path d="M6.5 9h3" />
    </svg>
  );
}

export function ClockIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 ${className}`}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.8V8l2.2 1.6" />
    </svg>
  );
}

export function TrashIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 ${className}`}>
      <path d="M2.5 4.5h11" />
      <path d="M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5" />
      <path d="M4 4.5l.7 8.1a1.5 1.5 0 0 0 1.5 1.4h3.6a1.5 1.5 0 0 0 1.5-1.4l.7-8.1" />
      <path d="M6.5 7.5v3.5M9.5 7.5v3.5" />
    </svg>
  );
}

export function StarIcon({
  className = "",
  filled = false,
}: {
  className?: string;
  filled?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      className={`h-4 w-4 ${className}`}
    >
      <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.2L8 11.5l-3.8 2 .7-4.2-3.1-3 4.3-.6L8 1.8z" />
    </svg>
  );
}

export function GearIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 ${className}`}>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.6v1.8M8 12.6v1.8M1.6 8h1.8M12.6 8h1.8M3.5 3.5l1.3 1.3M11.2 11.2l1.3 1.3M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3" />
    </svg>
  );
}

export function ClipIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 ${className}`}>
      <path d="M13 7.5l-4.6 4.6a3 3 0 0 1-4.2-4.2L8.8 3.3a2 2 0 0 1 2.8 2.8L7 10.7a1 1 0 0 1-1.4-1.4l4.2-4.2" />
    </svg>
  );
}

export function PenIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 ${className}`}>
      <path d="M11.2 2.3a1.6 1.6 0 0 1 2.3 2.3L5.6 12.5 2.5 13.5l1-3.1 7.7-8.1z" />
    </svg>
  );
}

export function ChatIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className={`h-4 w-4 ${className}`}
    >
      <path
        d="M14 7.7c0 3-2.7 5.3-6 5.3-.8 0-1.6-.1-2.3-.4L2 13.5l1-2.6A5 5 0 0 1 2 7.7c0-3 2.7-5.2 6-5.2s6 2.3 6 5.2z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SparkIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={`h-3.5 w-3.5 ${className}`}>
      <path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6L8 1z" />
    </svg>
  );
}
