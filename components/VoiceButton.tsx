"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Microphone input button. Two engines:
 *  - "browser": Web Speech API (free, Chrome/Safari; no server round-trip)
 *  - "elevenlabs": records audio and transcribes via /api/stt (Scribe)
 * Adapted from Jon's reference implementation; logic kept intact, visuals
 * translated to Tria's palette and inline SVG icons.
 */

interface Props {
  onResult: (text: string) => void;
  onInterim?: (text: string) => void;
  color?: string;
  size?: number;         // square size in px
  round?: boolean;       // fully circular (FAB)
  startSignal?: number;  // bump to start listening programmatically
  mode?: "browser" | "elevenlabs";
}

type SpeechRecognition = any; // Web Speech API isn't in the standard lib types

function MicGlyph({ size, className }: { size: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="5.75" y="1.75" width="4.5" height="7.5" rx="2.25" />
      <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0" />
      <path d="M8 12v2.25" />
    </svg>
  );
}

function MicOffGlyph({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5.75" y="1.75" width="4.5" height="7.5" rx="2.25" />
      <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0" />
      <path d="M8 12v2.25" />
      <path d="M2 2l12 12" />
    </svg>
  );
}

export default function VoiceButton({
  onResult,
  onInterim,
  color = "#c96f4a", // Tria clay
  size = 52,
  round = false,
  startSignal = 0,
  mode = "browser",
}: Props) {
  const radius = round ? Math.round(size / 2) : Math.round(size * 0.27);
  const iconSize = Math.round(size * 0.46);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [supported, setSupported] = useState(true);
  const recRef = useRef<SpeechRecognition | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const vadRafRef = useRef<number>(0);
  const onResultRef = useRef(onResult);
  const onInterimRef = useRef(onInterim);
  const finalTextRef = useRef("");
  const interimTextRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppingRef = useRef(false);

  const SILENCE_MS = 2500;         // after you start talking: silence to finalize
  const INITIAL_SILENCE_MS = 9000; // window to START speaking before it gives up
  const clearSilence = () => { if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; } };
  const armSilence = (ms = SILENCE_MS) => {
    clearSilence();
    silenceTimerRef.current = setTimeout(() => { stoppingRef.current = true; try { recRef.current?.stop(); } catch {} }, ms);
  };

  useEffect(() => { onResultRef.current = onResult; onInterimRef.current = onInterim; }, [onResult, onInterim]);

  useEffect(() => {
    if (mode === "elevenlabs") {
      setSupported(typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined");
      return;
    }
    const SR = (typeof window !== "undefined" && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) || null;
    if (!SR) { setSupported(false); return; }
    setSupported(true);
    const rec: SpeechRecognition = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    rec.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTextRef.current += transcript + " ";
        else interim += transcript;
      }
      interimTextRef.current = interim;
      onInterimRef.current?.((finalTextRef.current + interim).trim());
      armSilence();
    };

    rec.onend = () => {
      if (stoppingRef.current) {
        clearSilence();
        stoppingRef.current = false;
        setListening(false);
        const result = (finalTextRef.current + " " + interimTextRef.current).trim();
        finalTextRef.current = ""; interimTextRef.current = "";
        if (result) onResultRef.current(result);
      } else {
        if (interimTextRef.current) { finalTextRef.current += interimTextRef.current + " "; interimTextRef.current = ""; }
        try { rec.start(); } catch { clearSilence(); setListening(false); }
      }
    };

    rec.onerror = (event: any) => {
      if (event?.error === "not-allowed" || event?.error === "service-not-allowed" || event?.error === "aborted") stoppingRef.current = true;
    };

    recRef.current = rec;
    return () => { clearSilence(); try { rec.abort(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ---- ElevenLabs Scribe recording (only used when mode === "elevenlabs") ----
  const cleanupRecording = () => {
    if (vadRafRef.current) { cancelAnimationFrame(vadRafRef.current); vadRafRef.current = 0; }
    mediaStreamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch {} });
    mediaStreamRef.current = null;
    try { audioCtxRef.current?.close(); } catch {}
    audioCtxRef.current = null;
  };
  const finalizeRecording = async () => {
    cleanupRecording();
    const chunks = audioChunksRef.current; audioChunksRef.current = [];
    setListening(false);
    if (!chunks.length) { onInterimRef.current?.(""); return; }
    const blob = new Blob(chunks, { type: chunks[0].type || "audio/webm" });
    setTranscribing(true); onInterimRef.current?.("Transcribing…");
    try {
      const fd = new FormData(); fd.append("file", blob, "audio.webm");
      const res = await fetch("/api/stt", { method: "POST", body: fd });
      setTranscribing(false);
      if (!res.ok) { onInterimRef.current?.(""); return; }
      const data = await res.json();
      const text = typeof data?.text === "string" ? data.text.trim() : "";
      if (text) onResultRef.current(text); else onInterimRef.current?.("");
    } catch { setTranscribing(false); onInterimRef.current?.(""); }
  };
  const stopRecording = () => {
    if (vadRafRef.current) { cancelAnimationFrame(vadRafRef.current); vadRafRef.current = 0; }
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") { try { mr.stop(); } catch {} } else finalizeRecording();
  };
  const startVAD = (stream: MediaStream) => {
    try {
      const AC: typeof AudioContext | undefined = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC(); audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser(); analyser.fftSize = 512; src.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const started = performance.now(); let lastLoud = started; let spoke = false;
      const SIL_MS = 2500, THRESH = 0.02, MAX_MS = 30000, NO_SPEECH_MS = 9000;
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / buf.length); const t = performance.now();
        if (rms > THRESH) { lastLoud = t; spoke = true; }
        if ((spoke && t - lastLoud > SIL_MS) || (!spoke && t - started > NO_SPEECH_MS) || t - started > MAX_MS) { stopRecording(); return; }
        vadRafRef.current = requestAnimationFrame(tick);
      };
      vadRafRef.current = requestAnimationFrame(tick);
    } catch {}
  };
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream; audioChunksRef.current = [];
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => (window as any).MediaRecorder?.isTypeSupported?.(m));
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => { if (e.data && e.data.size) audioChunksRef.current.push(e.data); };
      mr.onstop = () => { finalizeRecording(); };
      mr.start(); setListening(true); onInterimRef.current?.("Listening…"); startVAD(stream);
    } catch { cleanupRecording(); setListening(false); }
  };
  useEffect(() => () => cleanupRecording(), []);

  const startListening = () => {
    if (mode === "elevenlabs") { startRecording(); return; }
    const rec = recRef.current; if (!rec) return;
    finalTextRef.current = ""; interimTextRef.current = ""; stoppingRef.current = false;
    try { rec.start(); setListening(true); armSilence(INITIAL_SILENCE_MS); } catch {}
  };
  const toggle = () => {
    if (mode === "elevenlabs") { if (listening) stopRecording(); else if (!transcribing) startListening(); return; }
    const rec = recRef.current; if (!rec) return;
    if (listening) { stoppingRef.current = true; try { rec.stop(); } catch {} } else startListening();
  };
  useEffect(() => { if (startSignal > 0) startListening(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [startSignal]);

  if (!supported) {
    return (
      <button title="Voice input not supported in this browser" disabled
        style={{ width: size, height: size, borderRadius: radius, border: "1px solid var(--color-line)", background: "var(--color-paper)", color: "var(--color-ink-faint)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <MicOffGlyph size={iconSize} />
      </button>
    );
  }

  const active = listening || transcribing;
  const LIVE_RED = "#e5484d";
  return (
    <button
      onClick={toggle}
      title={transcribing ? "Transcribing…" : listening ? "Stop listening" : "Speak"}
      className={listening ? "mic-live" : undefined}
      aria-pressed={listening}
      style={{
        width: size, height: size, borderRadius: radius,
        border: listening ? `1px solid ${LIVE_RED}` : active ? `1px solid ${color}` : round ? "1px solid var(--color-line)" : `1px solid ${color}55`,
        background: listening ? LIVE_RED : transcribing ? color : round ? "white" : `${color}12`,
        color: active ? "#ffffff" : color,
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: listening ? undefined : round ? "0 8px 22px rgba(0,0,0,0.16)" : "none",
        opacity: transcribing ? 0.85 : 1,
        transition: "background .15s ease, border-color .15s ease, color .15s ease",
        flexShrink: 0,
      }}
    >
      <MicGlyph size={iconSize} className={listening ? "mic-live-icon" : undefined} />
    </button>
  );
}
