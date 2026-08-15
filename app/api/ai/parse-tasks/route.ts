import { NextRequest, NextResponse } from "next/server";
import { llmChat, llmProvider, LlmRefusal } from "@/lib/server/llm";

/**
 * Split a spoken or typed brain-dump ("email Jon, book flights, 30 min gym")
 * into individual Tria tasks. Same structured-output pattern as /api/ai/task.
 */

export const maxDuration = 60;

const SCHEMA = {
  type: "object",
  properties: {
    tasks: {
      type: "array",
      description: "One entry per distinct task in the dump. 1-15 items.",
      items: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Imperative, under 60 characters, e.g. 'Call the dentist'.",
          },
          note: {
            type: "string",
            description:
              "Short context from the dump — time estimates ('≈30 min'), names, places. Empty string if none.",
          },
          priority: { type: "string", enum: ["high", "medium", "low"] },
          due: {
            type: "string",
            description:
              "Deadline as the speaker phrased it ('tomorrow', 'Friday'). Empty string if none.",
          },
          checklist: {
            type: "array",
            description:
              "Sub-steps ONLY when the dump spells them out. Usually empty.",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
              },
              required: ["label"],
              additionalProperties: false,
            },
          },
        },
        required: ["title", "note", "priority", "due", "checklist"],
        additionalProperties: false,
      },
    },
  },
  required: ["tasks"],
  additionalProperties: false,
} as const;

export type ParsedTaskDraft = {
  title: string;
  note: string;
  priority: "high" | "medium" | "low";
  due: string;
  checklist: { label: string }[];
};

/**
 * No-key fallback: split on list boundaries only — newline, comma, semicolon,
 * "(and) then" — never bare "and", so "Track and field signup" stays one task.
 */
function fallbackParse(text: string): ParsedTaskDraft[] {
  return text
    .split(/\n|[,;]|\b(?:and\s+)?then\b/gi)
    .map((s) => s.trim().replace(/^(?:and|also)\s+/i, ""))
    .filter((s) => s.length > 1)
    .slice(0, 15)
    .map((s) => ({
      title:
        (s[0].toUpperCase() + s.slice(1)).length > 60
          ? s[0].toUpperCase() + s.slice(1, 57) + "…"
          : s[0].toUpperCase() + s.slice(1),
      note: "",
      priority: "medium" as const,
      due: "",
      checklist: [],
    }));
}

export async function POST(req: NextRequest) {
  const { text, now } = (await req.json()) as { text?: string; now?: string };
  if (!text?.trim())
    return NextResponse.json(
      { ok: false, error: "Nothing to parse." },
      { status: 400 }
    );

  if (!(await llmProvider()))
    // degrade rather than fail: a dumb split still beats losing the dump
    return NextResponse.json({
      ok: true,
      tasks: fallbackParse(text),
      fallback: true,
    });

  try {
    const out = await llmChat({
      maxTokens: 2048,
      schema: SCHEMA,
      system:
        "You turn a rough brain-dump into a clean task list. The input is one unstructured blur — spoken or typed — that may pack several unrelated tasks into one breath. Split it into individual tasks, one per distinct thing to do. Keep the speaker's words where they're already concrete; don't invent tasks, deadlines, or priorities that aren't implied. Mentions of urgency ('asap', 'before Friday') set priority and due; time estimates go in the note.",
      messages: [
        {
          role: "user",
          content: `${now ? `Today is ${now}.\n\n` : ""}${text}`,
        },
      ],
    });

    const parsed = JSON.parse(out) as { tasks?: ParsedTaskDraft[] };
    // weaker providers can return shape-adjacent JSON — the splitter is a
    // better outcome than a crashed route
    const tasks: ParsedTaskDraft[] = (Array.isArray(parsed?.tasks) ? parsed.tasks : [])
      .filter((t) => typeof t?.title === "string" && t.title.trim())
      .map((t) => ({
        title: t.title.trim(),
        note: typeof t.note === "string" ? t.note : "",
        priority:
          t.priority === "high" || t.priority === "low" ? t.priority : "medium",
        due: typeof t.due === "string" ? t.due : "",
        checklist: Array.isArray(t.checklist)
          ? t.checklist.filter((c) => typeof c?.label === "string")
          : [],
      }));
    if (tasks.length === 0)
      return NextResponse.json({ ok: true, tasks: fallbackParse(text), fallback: true });
    return NextResponse.json({ ok: true, tasks });
  } catch (e) {
    if (e instanceof LlmRefusal)
      return NextResponse.json(
        { ok: false, error: "Claude declined to parse that." },
        { status: 422 }
      );
    console.error("parse tasks failed, using splitter", e);
    return NextResponse.json({ ok: true, tasks: fallbackParse(text), fallback: true });
  }
}
