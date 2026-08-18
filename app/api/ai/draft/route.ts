import { NextRequest, NextResponse } from "next/server";
import {
  briefLlmError,
  llmChat,
  llmProvider,
  LlmRefusal,
  NO_PROVIDER_MSG,
} from "@/lib/server/llm";

/**
 * Draft a reply the user steers. The button doesn't fire blind: the client
 * asks "what do you want to say?", and that instruction — plus the message
 * being answered, and any previous draft when the user asks to change it —
 * is what Claude writes from. Returns just the reply body; the app appends
 * the signature, so the model must not add one.
 */

export const maxDuration = 60;

type Body = {
  /** who/what is being replied to */
  from?: string;
  subject?: string;
  message?: string;
  /** what the user wants to convey (their steering line) */
  instruction?: string;
  /** the current draft, when the user is asking to revise it */
  current?: string;
  /** the sender's own name, for sign-off tone (not a signature) */
  me?: string;
};

export async function POST(req: NextRequest) {
  if (!llmProvider())
    return NextResponse.json({ ok: false, error: NO_PROVIDER_MSG }, { status: 503 });

  const { from, subject, message, instruction, current, me } =
    (await req.json()) as Body;

  const system = [
    `You draft an email reply for ${me || "the user"}, who received the message below.`,
    "Write ONLY the reply body — no subject line, and no signature or sign-off name (the app adds the signature).",
    "Sound like a real person: warm, direct, professional, and concise. Match the formality of the original.",
    "Use what the user wants to say as the substance; fill in the natural connective wording around it.",
    "If the user asks to change an existing draft, revise that draft rather than starting over.",
  ].join(" ");

  const parts: string[] = [];
  parts.push(
    `--- Message being replied to ---\nFrom: ${from ?? "unknown"}\nSubject: ${subject ?? "(no subject)"}\n\n${message ?? "(no body available)"}`
  );
  if (current?.trim())
    parts.push(`--- Current draft (revise this) ---\n${current.trim()}`);
  parts.push(
    `--- What ${me || "the user"} wants to say ---\n${
      instruction?.trim() || "Write an appropriate reply."
    }`
  );

  try {
    const text = await llmChat({
      system,
      maxTokens: 1024,
      messages: [{ role: "user", content: parts.join("\n\n") }],
    });
    return NextResponse.json({ ok: true, draft: (text || "").trim() });
  } catch (e) {
    if (e instanceof LlmRefusal)
      return NextResponse.json(
        { ok: false, error: "Claude declined to draft that one." },
        { status: 422 }
      );
    return NextResponse.json(
      { ok: false, error: briefLlmError(e) },
      { status: 500 }
    );
  }
}
