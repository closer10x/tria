import { Attachment, Email, Task } from "@/lib/types";
import { ClipIcon, SparkIcon } from "./ui";

export default function AttachmentCard({
  attachment,
  emails,
  tasks,
}: {
  attachment: Attachment;
  emails: Email[];
  tasks: Task[];
}) {
  if (attachment.type === "file") {
    return (
      <div className="mt-1.5 space-y-1">
        {attachment.files.map((f) => (
          <div
            key={f.name}
            className="flex items-center gap-2 rounded-lg border hairline bg-white/80 px-2.5 py-1.5"
          >
            <ClipIcon className="h-3.5 w-3.5 shrink-0 text-(--color-ink-faint)" />
            <span className="truncate text-xs font-medium text-(--color-ink)">
              {f.name}
            </span>
            {f.size && (
              <span className="ml-auto shrink-0 text-[10px] text-(--color-ink-faint)">
                {f.size}
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }
  if (attachment.type === "email") {
    const email = emails.find((e) => e.id === attachment.refId);
    if (!email) return null;
    return (
      <div className="mt-1.5 rounded-lg border hairline bg-white/80 p-2.5">
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-(--color-ink-faint)">
          ✉ Email · {email.from.name}
        </p>
        <p className="mt-0.5 truncate text-xs font-semibold text-(--color-ink)">
          {email.subject}
        </p>
        <p className="truncate text-[11px] text-(--color-ink-soft)">
          {email.preview}
        </p>
      </div>
    );
  }
  const task = tasks.find((t) => t.id === attachment.refId);
  if (!task) return null;
  const done = task.checklist.filter((c) => c.done).length;
  return (
    <div className="mt-1.5 rounded-lg border border-(--color-clay)/25 bg-(--color-clay-soft)/60 p-2.5">
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-(--color-clay)">
        <SparkIcon className="h-2.5 w-2.5" /> Smart Task
      </p>
      <p className="mt-0.5 truncate text-xs font-semibold text-(--color-ink)">
        {task.title}
      </p>
      <p className="text-[11px] text-(--color-ink-soft)">
        {task.due ? `Due ${task.due} · ` : ""}
        {task.checklist.length > 0
          ? `${done}/${task.checklist.length} steps done`
          : task.status}
      </p>
    </div>
  );
}
