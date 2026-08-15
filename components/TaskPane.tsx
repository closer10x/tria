"use client";

import { useState } from "react";
import { Email, Task, TaskPriority, TaskStatus } from "@/lib/types";
import type { ParsedTaskDraft } from "@/app/api/ai/parse-tasks/route";
import BrainDump from "./BrainDump";
import { ChatIcon, ClipIcon, PaneHeader, PinIcon, SparkIcon, TrashIcon } from "./ui";

const statusOrder: TaskStatus[] = ["doing", "todo", "done"];
const statusLabel: Record<TaskStatus, string> = {
  doing: "In motion",
  todo: "Up next",
  done: "Done",
};

const prioMeta: Record<TaskPriority, { dot: string; label: string }> = {
  high: { dot: "bg-(--color-clay)", label: "High" },
  medium: { dot: "bg-(--color-gold)", label: "Med" },
  low: { dot: "bg-(--color-ink-faint)", label: "Low" },
};

function StatusRing({
  status,
  onClick,
}: {
  status: TaskStatus;
  onClick: () => void;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title="Cycle status"
      className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-all ${
        status === "done"
          ? "border-(--color-sage) bg-(--color-sage)"
          : status === "doing"
            ? "border-(--color-clay) bg-(--color-clay-soft)"
            : "border-(--color-ink-faint)/50 bg-white hover:border-(--color-clay)"
      }`}
    >
      {status === "done" && (
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none">
          <path
            d="M2.5 6.5l2.2 2.2L9.5 3.9"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {status === "doing" && (
        <span className="h-1.5 w-1.5 rounded-full bg-(--color-clay)" />
      )}
    </button>
  );
}

export default function TaskPane({
  tasks,
  emails,
  highlightId,
  onCycleStatus,
  onToggleChecklist,
  onOpenSource,
  onDiscuss,
  onAskAi,
  onReorder,
  onDropEmail,
  onTogglePin,
  onDelete,
  onBrainDump,
}: {
  tasks: Task[];
  emails: Email[];
  highlightId: string | null;
  onCycleStatus: (id: string) => void;
  onToggleChecklist: (taskId: string, itemId: string) => void;
  onOpenSource: (emailId: string) => void;
  onDiscuss: (task: Task) => void;
  onAskAi: (task: Task) => void;
  onReorder: (dragId: string, targetId: string) => void;
  onDropEmail: (emailId: string) => void;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
  /** Optional until the page wires it — the dump bar hides when absent. */
  onBrainDump?: (drafts: ParsedTaskDraft[]) => void;
}) {
  const open = tasks.filter((t) => t.status !== "done").length;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [emailOver, setEmailOver] = useState(false);

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section
      className={`pane relative flex h-full min-h-0 flex-col rounded-xl transition-shadow ${
        emailOver ? "ring-2 ring-(--color-clay)" : ""
      }`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("text/tria-email")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setEmailOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node))
          setEmailOver(false);
      }}
      onDrop={(e) => {
        const emailId = e.dataTransfer.getData("text/tria-email");
        setEmailOver(false);
        if (emailId) {
          e.preventDefault();
          onDropEmail(emailId);
        }
      }}
    >
      <PaneHeader
        icon={<SparkIcon />}
        title="Smart Tasks"
        count={emailOver ? "drop to create" : `${open} open`}
      />
      <div className="nice-scroll min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-4">
        {statusOrder.map((status) => {
          const group = tasks.filter((t) => t.status === status);
          if (group.length === 0) return null;
          return (
            <div key={status} className="mb-5">
              <p className="mb-1 font-display text-[10px] font-normal uppercase tracking-[0.22em] text-(--color-ink-faint)">
                {statusLabel[status]} · {group.length}
              </p>
              <div className="divide-y divide-(--color-line)">
                {group.map((task) => {
                  const source = task.sourceEmailId
                    ? emails.find((e) => e.id === task.sourceEmailId)
                    : undefined;
                  const doneCount = task.checklist.filter((c) => c.done).length;
                  const isOpen =
                    expanded.has(task.id) || Boolean(task.justCreated);
                  return (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/tria-task", task.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(e) => {
                        if (e.dataTransfer.types.includes("text/tria-task"))
                          e.preventDefault();
                      }}
                      onDrop={(e) => {
                        const dragId = e.dataTransfer.getData("text/tria-task");
                        if (dragId && dragId !== task.id) {
                          e.preventDefault();
                          e.stopPropagation();
                          onReorder(dragId, task.id);
                        }
                      }}
                      onClick={() =>
                        task.checklist.length > 0 && toggleExpand(task.id)
                      }
                      className={`group cursor-pointer py-3.5 transition-colors ${
                        task.justCreated ? "rise-in" : ""
                      } ${
                        highlightId === task.id
                          ? "bg-(--color-clay-soft)/40"
                          : "hover:bg-(--color-paper)/60"
                      } ${task.status === "done" ? "opacity-50" : ""}`}
                    >
                      <div className="flex items-start gap-3">
                        <StatusRing
                          status={task.status}
                          onClick={() => onCycleStatus(task.id)}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start gap-2">
                            {/* two lines, not one: the title is the only
                                preview a task gets, so an AI-written one
                                like "Send Camry photos and confirm the
                                deductible" needs room to actually read */}
                            <p
                              className={`min-w-0 flex-1 line-clamp-2 font-display text-[15px] font-medium leading-snug ${
                                task.status === "done" ? "line-through" : ""
                              }`}
                            >
                              {task.title}
                            </p>
                            <span
                              className={`flex shrink-0 items-center gap-1 transition-opacity group-hover:opacity-100 ${
                                task.pinned ? "opacity-100" : "opacity-0"
                              }`}
                            >
                              <button
                                title={task.pinned ? "Unpin" : "Pin to top"}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onTogglePin(task.id);
                                }}
                                className={`rounded-md p-1.5 transition-colors hover:bg-(--color-clay-soft) hover:text-(--color-clay) ${
                                  task.pinned
                                    ? "text-(--color-clay)"
                                    : "text-(--color-ink-faint)"
                                }`}
                              >
                                <PinIcon
                                  className="h-3.5 w-3.5"
                                  filled={task.pinned}
                                />
                              </button>
                              <button
                                title="Delete task"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDelete(task.id);
                                }}
                                className="rounded-md p-1.5 text-(--color-ink-faint) transition-colors hover:bg-red-50 hover:text-red-500"
                              >
                                <TrashIcon className="h-3.5 w-3.5" />
                              </button>
                              <button
                                title="Ask AI"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onAskAi(task);
                                }}
                                className="rounded-md p-1.5 text-(--color-ink-faint) transition-colors hover:bg-(--color-clay-soft) hover:text-(--color-clay)"
                              >
                                <SparkIcon className="h-3.5 w-3.5" />
                              </button>
                              <button
                                title="Discuss in thread"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDiscuss(task);
                                }}
                                className="rounded-md p-1.5 text-(--color-ink-faint) transition-colors hover:bg-(--color-paper) hover:text-(--color-ink)"
                              >
                                <ChatIcon className="h-3.5 w-3.5" />
                              </button>
                            </span>
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-(--color-ink-faint)">
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${prioMeta[task.priority].dot}`}
                              />
                              {prioMeta[task.priority].label}
                            </span>
                            {task.due && (
                              <span className="text-(--color-ink-soft)">
                                {task.due}
                              </span>
                            )}
                            {source && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenSource(source.id);
                                }}
                                className="truncate transition-colors hover:text-(--color-clay)"
                                title={`From: ${source.subject}`}
                              >
                                ✉ {source.from.name}
                              </button>
                            )}
                            {task.checklist.length > 0 && (
                              <span className="ml-auto inline-flex items-center gap-1.5">
                                {doneCount}/{task.checklist.length}
                                <span className="h-[3px] w-16 overflow-hidden rounded-full bg-(--color-line)">
                                  <span
                                    className="block h-full rounded-full bg-(--color-sage) transition-all duration-500"
                                    style={{
                                      width: `${Math.round((doneCount / task.checklist.length) * 100)}%`,
                                    }}
                                  />
                                </span>
                                <span
                                  className={`text-[9px] transition-transform ${isOpen ? "rotate-180" : ""}`}
                                >
                                  ▾
                                </span>
                              </span>
                            )}
                          </div>

                          {task.attachments && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {task.attachments.map((a) => (
                                <span
                                  key={a.name}
                                  className="inline-flex items-center gap-1 rounded-md border hairline bg-(--color-paper) px-1.5 py-0.5 text-[10px] font-medium text-(--color-ink-soft)"
                                >
                                  <ClipIcon className="h-2.5 w-2.5 text-(--color-ink-faint)" />
                                  {a.name}
                                </span>
                              ))}
                            </div>
                          )}

                          {isOpen && task.checklist.length > 0 && (
                            <div className="mt-2.5 space-y-1.5">
                              {task.checklist.map((item) => (
                                <button
                                  key={item.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onToggleChecklist(task.id, item.id);
                                  }}
                                  className="flex w-full items-center gap-2 text-left"
                                >
                                  <span
                                    className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
                                      item.done
                                        ? "border-(--color-sage) bg-(--color-sage)"
                                        : "hairline bg-white"
                                    }`}
                                  >
                                    {item.done && (
                                      <svg
                                        viewBox="0 0 10 10"
                                        className="h-2 w-2 text-white"
                                        fill="none"
                                      >
                                        <path
                                          d="M2 5.2l1.8 1.8L8 3"
                                          stroke="currentColor"
                                          strokeWidth="1.8"
                                          strokeLinecap="round"
                                        />
                                      </svg>
                                    )}
                                  </span>
                                  <span
                                    className={`text-xs ${
                                      item.done
                                        ? "text-(--color-ink-faint) line-through"
                                        : "text-(--color-ink-soft)"
                                    }`}
                                  >
                                    {item.label}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {tasks.length === 0 && (
          // centred on both axes, not just pushed down from the top
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-(--color-ink-faint)">
            <div>
              <p className="mb-1 text-2xl">✦</p>
              Open an email and tap{" "}
              <span className="font-semibold text-(--color-clay)">
                Make Smart Task
              </span>
            </div>
          </div>
        )}
      </div>
      {/* floats over the list, bottom-right, like the Mail pane's compose */}
      {onBrainDump && <BrainDump onTasks={onBrainDump} />}
    </section>
  );
}
