import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

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

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key)
    // degrade rather than fail: a dumb split still beats losing the dump
    return NextResponse.json({
      ok: true,
      tasks: fallbackParse(text),
      fallback: true,
    });

  try {
    const client = new Anthropic({ apiKey: key });
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 2048,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SCHEMA },
      },
      system:
        "You turn a rough brain-dump into a clean task list. The input is one unstructured blur — spoken or typed — that may pack several unrelated tasks into one breath. Split it into individual tasks, one per distinct thing to do. Keep the speaker's words where they're already concrete; don't invent tasks, deadlines, or priorities that aren't implied. Mentions of urgency ('asap', 'before Friday') set priority and due; time estimates go in the note.",
      messages: [
        {
          role: "user",
          content: `${now ? `Today is ${now}.\n\n` : ""}${text}`,
        },
      ],
    });

    if (response.stop_reason === "refusal")
      return NextResponse.json(
        { ok: false, error: "Claude declined to parse that." },
        { status: 422 }
      );

    const out = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const parsed = JSON.parse(out) as { tasks: ParsedTaskDraft[] };
    return NextResponse.json({ ok: true, tasks: parsed.tasks });
  } catch (e) {
    console.error("parse tasks failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Parsing failed" },
      { status: 500 }
    );
  }
}
