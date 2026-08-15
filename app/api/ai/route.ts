import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

/**
 * The AI pane, backed by Claude. The client sends the conversation plus a
 * snapshot of what's on screen — mail, tasks, threads — so answers are about
 * the user's actual inbox rather than generic advice.
 */

export const maxDuration = 60;

type Turn = { role: "user" | "assistant"; text: string };

type Context = {
  emails?: {
    from: string;
    subject: string;
    preview: string;
    folder: string;
    read: boolean;
    time: string;
  }[];
  tasks?: {
    title: string;
    status: string;
    priority: string;
    due?: string;
    checklist: { label: string; done: boolean }[];
  }[];
  threads?: { name: string; members: string[]; lastMessage?: string }[];
  accounts?: string[];
  now?: string;
};

function buildSystem(ctx: Context): string {
  const lines: string[] = [
    "You are the assistant inside Tria, a mail and task app. You are talking to the person whose inbox this is.",
    "Answer from the context below — it is a live snapshot of what they are looking at right now.",
    "Be direct and brief. Lead with the answer. Skip preamble and don't restate the question.",
    "If the context doesn't contain what's needed, say so plainly rather than guessing.",
    "You cannot send mail or change anything yet — describe what you'd do and let them act.",
  ];
  if (ctx.now) lines.push(`\nCurrent date and time: ${ctx.now}`);
  if (ctx.accounts?.length)
    lines.push(`Connected mail accounts: ${ctx.accounts.join(", ")}`);

  if (ctx.emails?.length) {
    lines.push("\n<mail>");
    for (const e of ctx.emails.slice(0, 60)) {
      lines.push(
        `- [${e.folder}${e.read ? "" : ", unread"}] ${e.from} — ${e.subject} (${e.time})${
          e.preview ? `\n  ${e.preview}` : ""
        }`
      );
    }
    lines.push("</mail>");
  } else {
    lines.push("\n<mail>No mail is loaded.</mail>");
  }

  if (ctx.tasks?.length) {
    lines.push("\n<tasks>");
    for (const t of ctx.tasks) {
      const done = t.checklist.filter((c) => c.done).length;
      lines.push(
        `- ${t.title} — ${t.status}, ${t.priority} priority${t.due ? `, due ${t.due}` : ""} (${done}/${t.checklist.length} steps)`
      );
    }
    lines.push("</tasks>");
  }

  if (ctx.threads?.length) {
    lines.push("\n<threads>");
    for (const t of ctx.threads) {
      lines.push(
        `- ${t.name} (${t.members.join(", ")})${t.lastMessage ? ` — last: ${t.lastMessage}` : ""}`
      );
    }
    lines.push("</threads>");
  }

  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "The AI pane isn't configured yet — set ANTHROPIC_API_KEY on the server and redeploy.",
      },
      { status: 503 }
    );
  }

  const { turns, context } = (await req.json()) as {
    turns: Turn[];
    context: Context;
  };
  if (!turns?.length)
    return NextResponse.json({ ok: false, error: "No message" }, { status: 400 });

  try {
    const client = new Anthropic({ apiKey: key });
    const response = await client.messages.create({
      model: "claude-opus-5",
      // chat replies in a side panel are deliberately short
      max_tokens: 2048,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system: buildSystem(context ?? {}),
      messages: turns.map((t) => ({ role: t.role, content: t.text })),
    });

    if (response.stop_reason === "refusal") {
      return NextResponse.json({
        ok: true,
        text: "I can't help with that one.",
      });
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return NextResponse.json({ ok: true, text: text || "(no answer)" });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    if (err.status === 401)
      return NextResponse.json(
        { ok: false, error: "Claude rejected the API key — check ANTHROPIC_API_KEY." },
        { status: 401 }
      );
    if (err.status === 429)
      return NextResponse.json(
        { ok: false, error: "Rate limited by Claude — try again in a moment." },
        { status: 429 }
      );
    return NextResponse.json(
      { ok: false, error: err.message ?? "The AI request failed." },
      { status: 500 }
    );
  }
}
