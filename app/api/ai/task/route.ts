import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Turn an email into a smart task by reading it: one checklist item per thing
 * actually being asked for, so "pictures of my car and pictures of the
 * interior" becomes two steps rather than a generic "reply to sender".
 */

export const maxDuration = 60;

const SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description:
        "Imperative summary of what the recipient has to do, under 60 characters.",
    },
    note: {
      type: "string",
      description: "One short line of context. Empty string if none is needed.",
    },
    priority: { type: "string", enum: ["high", "medium", "low"] },
    due: {
      type: "string",
      description:
        "Deadline the sender asked for, as they phrased it (e.g. 'Friday EOD'). Empty string if none.",
    },
    checklist: {
      type: "array",
      description:
        "One item per distinct thing being requested. Split compound asks apart. 1-6 items.",
      items: {
        type: "object",
        properties: {
          label: {
            type: "string",
            description: "A single concrete action, imperative, under 80 characters.",
          },
        },
        required: ["label"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "note", "priority", "due", "checklist"],
  additionalProperties: false,
} as const;

export type SmartTaskDraft = {
  title: string;
  note: string;
  priority: "high" | "medium" | "low";
  due: string;
  checklist: { label: string }[];
};

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key)
    return NextResponse.json(
      {
        ok: false,
        error:
          "Smart tasks need Claude — set ANTHROPIC_API_KEY on the server and redeploy.",
      },
      { status: 503 }
    );

  const { from, subject, body, now } = (await req.json()) as {
    from?: string;
    subject?: string;
    body?: string;
    now?: string;
  };

  try {
    const client = new Anthropic({ apiKey: key });
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 1024,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SCHEMA },
      },
      system:
        "You turn an email into a task for the person who received it. Read the whole message and list every distinct thing the sender is asking for as its own checklist item — a compound sentence asking for two things is two items. Ignore pleasantries and signatures. Use the recipient's perspective: the actions are things they must do.",
      messages: [
        {
          role: "user",
          content: `${now ? `Today is ${now}.\n\n` : ""}From: ${from ?? "unknown"}\nSubject: ${subject ?? "(no subject)"}\n\n${body ?? ""}`,
        },
      ],
    });

    if (response.stop_reason === "refusal")
      return NextResponse.json(
        { ok: false, error: "Claude declined to summarise that email." },
        { status: 422 }
      );

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const draft = JSON.parse(text) as SmartTaskDraft;
    return NextResponse.json({ ok: true, task: draft });
  } catch (e) {
    console.error("smart task failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Smart task failed" },
      { status: 500 }
    );
  }
}
