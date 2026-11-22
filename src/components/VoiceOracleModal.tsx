import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Send, X } from 'lucide-react';

interface VoiceOracleModalProps {
  open: boolean;
  worldContext: string;
  onClose: () => void;
  onSetAudioDucked: (ducked: boolean) => void;
}

interface TranscriptLine {
  id: string;
  speaker: 'you' | 'oracle';
  text: string;
}

function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

function base64ToFloat32Pcm(base64: string): Float32Array {
  const bin = atob(base64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

export const VoiceOracleModal: React.FC<VoiceOracleModalProps> = ({
  open,
  worldContext,
  onClose,
  onSetAudioDucked,
}) => {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'live' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptLine[]>([]);
  const [textInput, setTextInput] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);

  const cleanupSession = useCallback(() => {
    try {
      wsRef.current?.close();
    } catch {
      // ignore
    }
    wsRef.current = null;

    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }

    try {
      void inputCtxRef.current?.close();
      void outputCtxRef.current?.close();
    } catch {
      // ignore
    }
    inputCtxRef.current = null;
    outputCtxRef.current = null;
    nextPlayTimeRef.current = 0;
    onSetAudioDucked(false);
    setStatus('idle');
  }, [onSetAudioDucked]);

  useEffect(() => {
    if (!open) {
      cleanupSession();
    }
    return () => {
      cleanupSession();
    };
  }, [open, cleanupSession]);

  const scheduleAudioChunk = (base64Audio: string) => {
    if (!outputCtxRef.current) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      outputCtxRef.current = new AudioCtx({ sampleRate: 24000 });
      nextPlayTimeRef.current = outputCtxRef.current.currentTime;
    }
    const ctx = outputCtxRef.current;
    const samples = base64ToFloat32Pcm(base64Audio);
    const buffer = ctx.createBuffer(1, samples.length, 24000);
    buffer.getChannelData(0).set(samples);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);

    const startAt = Math.max(ctx.currentTime, nextPlayTimeRef.current);
    src.start(startAt);
    nextPlayTimeRef.current = startAt + buffer.duration;
  };

  const startLiveOracle = async () => {
    setStatus('connecting');
    setErrorMsg(null);
    onSetAudioDucked(true);

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/api/live?context=${encodeURIComponent(worldContext)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as {
          ready?: boolean;
          audio?: string;
          inputTranscript?: string;
          outputTranscript?: string;
          error?: string;
          interrupted?: boolean;
          closed?: boolean;
        };

        if (msg.error) {
          setErrorMsg(msg.error);
          setStatus('error');
          cleanupSession();
          return;
        }

        if (msg.ready) {
          setStatus('live');
          // Attempt optional 16kHz mic capture; text fallback still works if mic denied
          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: { sampleRate: 16000, channelCount: 1 },
            });
            mediaStreamRef.current = stream;
            const AudioCtx =
              window.AudioContext ||
              (window as unknown as { webkitAudioContext: typeof AudioContext })
                .webkitAudioContext;
            const inCtx = new AudioCtx({ sampleRate: 16000 });
            inputCtxRef.current = inCtx;

            const source = inCtx.createMediaStreamSource(stream);
            const processor = inCtx.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
              const floatData = e.inputBuffer.getChannelData(0);
              const pcm = new Int16Array(floatData.length);
              for (let i = 0; i < floatData.length; i++) {
                const s = Math.max(-1, Math.min(1, floatData[i]));
                pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
              }
              wsRef.current.send(JSON.stringify({ audio: int16ToBase64(pcm) }));
            };
            source.connect(processor);
            processor.connect(inCtx.destination);
          } catch {
            // Mic permission denied or unavailable; player can still send text prompts
          }
        }

        if (msg.audio) {
          scheduleAudioChunk(msg.audio);
        }

        if (msg.interrupted && outputCtxRef.current) {
          nextPlayTimeRef.current = outputCtxRef.current.currentTime;
        }

        if (msg.inputTranscript) {
          setTranscripts((prev) => [
            ...prev.slice(-16),
            { id: `u-${Date.now()}-${Math.random()}`, speaker: 'you', text: msg.inputTranscript! },
          ]);
        }
        if (msg.outputTranscript) {
          setTranscripts((prev) => [
            ...prev.slice(-16),
            { id: `o-${Date.now()}-${Math.random()}`, speaker: 'oracle', text: msg.outputTranscript! },
          ]);
        }
        if (msg.closed) {
          setStatus('idle');
        }
      } catch {
        // ignore parse issues
      }
    };

    ws.onerror = () => {
      setErrorMsg('Unable to open real-time Live Oracle WebSocket session.');
      setStatus('error');
    };
  };

  const handleSendText = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = textInput.trim();
    if (!clean || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ text: clean }));
    setTranscripts((prev) => [
      ...prev.slice(-16),
      { id: `u-${Date.now()}`, speaker: 'you', text: clean },
    ]);
    setTextInput('');
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-[#0c1018]/76 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Live Voice Oracle"
    >
      <div className="w-full max-w-lg border border-[#e5a94c]/40 bg-[#121824] text-[#f3ece0] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#f3ece0]/12 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Mic className="h-5 w-5 text-[#e5a94c]" />
            <div>
              <h2 className="font-display text-lg font-bold tracking-[0.12em] uppercase">
                Living Atlas Oracle
              </h2>
              <p className="font-mono text-[11px] text-[#a79f90]">
                Real-Time Voice Bridge (Gemini 3.8 Live)
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close Voice Oracle"
            onClick={() => {
              cleanupSession();
              onClose();
            }}
            className="flex h-9 w-9 cursor-pointer items-center justify-center border border-[#f3ece0]/20 text-[#d8cfc0] transition hover:border-[#e5a94c] hover:text-[#e5a94c]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-xs leading-relaxed text-[#cfc6b6]">
            Speak or write to the Living Atlas Oracle. Your current biome, faction balance, and
            vector memories are bound to this session.
          </p>

          <div className="flex items-center gap-3">
            {status !== 'live' ? (
              <button
                type="button"
                disabled={status === 'connecting'}
                onClick={startLiveOracle}
                className="flex cursor-pointer items-center gap-2 border border-[#f5d18c] bg-[#e5a94c] px-4 py-2.5 font-mono text-xs font-bold tracking-wider text-[#101520] uppercase transition hover:bg-[#f2be6a] disabled:opacity-50"
              >
                <Mic className="h-4 w-4" />
                <span>{status === 'connecting' ? 'Connecting...' : 'Commune Live'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={cleanupSession}
                className="flex cursor-pointer items-center gap-2 border border-[#e05d5d] bg-[#2a151a] px-4 py-2.5 font-mono text-xs font-bold tracking-wider text-[#f7baba] uppercase transition hover:bg-[#3a1d23]"
              >
                <MicOff className="h-4 w-4" />
                <span>End Communion</span>
              </button>
            )}

            <span className="font-mono text-[11px] text-[#9eb3c7] uppercase">
              State: {status}
            </span>
          </div>

          {errorMsg && (
            <p className="border border-[#e05d5d]/45 bg-[#261317] px-3 py-2 text-xs text-[#f5b4b4]">
              {errorMsg}
            </p>
          )}

          <div className="h-48 space-y-2 overflow-y-auto border border-[#f3ece0]/12 bg-[#0e131d] p-3 text-xs">
            {transcripts.length === 0 ? (
              <p className="text-[#857e72]">
                Start a Live session to hear the Oracle respond in real time.
              </p>
            ) : (
              transcripts.map((line) => (
                <div
                  key={line.id}
                  className={
                    line.speaker === 'oracle'
                      ? 'border-l-2 border-[#e5a94c] pl-2.5 text-[#f3ece0]'
                      : 'border-l-2 border-[#7cd7f2] pl-2.5 text-[#a9d5eb]'
                  }
                >
                  <span className="font-mono text-[10px] uppercase">
                    {line.speaker === 'oracle' ? 'Oracle: ' : 'Wayfarer: '}
                  </span>
                  {line.text}
                </div>
              ))
            )}
          </div>

          <form onSubmit={handleSendText} className="flex gap-2">
            <input
              type="text"
              disabled={status !== 'live'}
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Send text prompt to Live Oracle..."
              className="min-w-0 flex-1 border border-[#f3ece0]/18 bg-[#151c29] px-3 py-2 text-xs text-[#f3ece0] placeholder:text-[#7f796f] focus:border-[#e5a94c] focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={status !== 'live'}
              aria-label="Send message to Oracle"
              className="flex cursor-pointer items-center justify-center border border-[#e5a94c]/60 bg-[#1c2434] px-3.5 text-[#f5d18c] transition hover:bg-[#e5a94c] hover:text-[#101520] disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
