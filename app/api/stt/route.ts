import { NextRequest, NextResponse } from "next/server";

/**
 * Speech-to-text proxy for VoiceButton's "elevenlabs" mode: forwards the
 * recorded audio blob to ElevenLabs Scribe and returns the transcript.
 * The browser mode (Web Speech API) never hits this route.
 */

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key)
    return NextResponse.json(
      {
        ok: false,
        error:
          "Server transcription needs ElevenLabs — set ELEVENLABS_API_KEY and redeploy, or use the browser voice mode.",
      },
      { status: 503 }
    );

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob) || file.size === 0)
      return NextResponse.json(
        { ok: false, error: "No audio received." },
        { status: 400 }
      );

    const upstream = new FormData();
    upstream.append("file", file, "audio.webm");
    upstream.append("model_id", "scribe_v1");
    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": key },
      body: upstream,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("elevenlabs stt failed", res.status, detail.slice(0, 300));
      return NextResponse.json(
        { ok: false, error: "Transcription failed." },
        { status: 502 }
      );
    }
    const data = (await res.json()) as { text?: string };
    return NextResponse.json({ ok: true, text: data.text ?? "" });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Transcription failed" },
      { status: 500 }
    );
  }
}
