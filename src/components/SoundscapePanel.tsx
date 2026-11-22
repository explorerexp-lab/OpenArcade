import React, { useState } from 'react';
import { Music, Volume2, VolumeX, X, Wand2 } from 'lucide-react';
import type { SoundMood } from '../game/types';

interface SoundscapePanelProps {
  open: boolean;
  mood: SoundMood;
  threat: number;
  biomeName: string;
  isMuted: boolean;
  onClose: () => void;
  onToggleMute: () => void;
  onSelectMood: (mood: SoundMood) => void;
  onSetDucked: (ducked: boolean) => void;
}

const MOODS: Array<{ key: SoundMood; label: string; scale: string }> = [
  { key: 'wonder', label: 'Wonder', scale: 'A Lydian' },
  { key: 'mystery', label: 'Mystery', scale: 'G Dorian' },
  { key: 'tension', label: 'Tension', scale: 'E Phrygian' },
  { key: 'melancholy', label: 'Melancholy', scale: 'F Aeolian' },
  { key: 'triumph', label: 'Triumph', scale: 'C Bright' },
];

export const SoundscapePanel: React.FC<SoundscapePanelProps> = ({
  open,
  mood,
  threat,
  biomeName,
  isMuted,
  onClose,
  onToggleMute,
  onSelectMood,
  onSetDucked,
}) => {
  const [prompt, setPrompt] = useState(
    'Sunlit highland stone observatory orchestral ambient soundtrack with resonant bronze bells, warm cello, and mountain flute.'
  );
  const [mode, setMode] = useState<'clip' | 'pro'>('clip');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioDataUrl, setAudioDataUrl] = useState<string | null>(null);
  const [lyrics, setLyrics] = useState<string>('');
  const [modelUsed, setModelUsed] = useState<string>('');

  if (!open) return null;

  const handleGenerateMusic = async () => {
    setBusy(true);
    setError(null);
    try {
      const enrichedPrompt = `${prompt} Biome: ${biomeName}. Emotional mode: ${mood}.`;
      const res = await fetch('/api/music/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: enrichedPrompt, mode }),
      });
      const data = (await res.json()) as {
        audioDataUrl?: string;
        lyrics?: string;
        model?: string;
        error?: string;
      };
      if (!res.ok || !data.audioDataUrl) {
        throw new Error(data.error || 'Music generation failed.');
      }
      setAudioDataUrl(data.audioDataUrl);
      setLyrics(data.lyrics || '');
      setModelUsed(data.model || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate music track.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-[#0c1018]/76 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Adaptive Soundscape and Lyria Music"
    >
      <div className="w-full max-w-lg border border-[#e5a94c]/40 bg-[#121824] text-[#f3ece0] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#f3ece0]/12 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Music className="h-5 w-5 text-[#e5a94c]" />
            <div>
              <h2 className="font-display text-lg font-bold tracking-[0.12em] uppercase">
                Adaptive Soundscape
              </h2>
              <p className="font-mono text-[11px] text-[#a79f90]">
                Real-Time Procedural Web Audio + Lyria Studio
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close Soundscape Panel"
            onClick={onClose}
            className="flex h-9 w-9 cursor-pointer items-center justify-center border border-[#f3ece0]/20 text-[#d8cfc0] transition hover:border-[#e5a94c] hover:text-[#e5a94c]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {/* On-Device Procedural Engine Controls */}
          <section className="border border-[#f3ece0]/14 bg-[#0f141f] p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-display text-sm font-bold tracking-wider text-[#e5a94c] uppercase">
                  On-Device Synth Engine
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-[#a79f90]">
                  Sentinel Proximity Threat: {Math.round(threat * 100)}%
                </div>
              </div>
              <button
                type="button"
                onClick={onToggleMute}
                className="flex cursor-pointer items-center gap-2 border border-[#f3ece0]/25 bg-[#182030] px-3 py-1.5 font-mono text-xs uppercase transition hover:border-[#e5a94c]"
              >
                {isMuted ? (
                  <>
                    <VolumeX className="h-4 w-4 text-[#e05d5d]" />
                    <span>Muted</span>
                  </>
                ) : (
                  <>
                    <Volume2 className="h-4 w-4 text-[#52c78c]" />
                    <span>Active</span>
                  </>
                )}
              </button>
            </div>

            <div className="mt-3.5 grid grid-cols-5 gap-1.5">
              {MOODS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => onSelectMood(m.key)}
                  className={`cursor-pointer border px-2 py-2 text-center transition ${
                    mood === m.key
                      ? 'border-[#e5a94c] bg-[#e5a94c]/20 text-[#f5d18c]'
                      : 'border-[#f3ece0]/14 bg-[#161e2c] text-[#c7beae] hover:border-[#e5a94c]/50'
                  }`}
                >
                  <div className="text-[11px] font-semibold">{m.label}</div>
                  <div className="mt-0.5 font-mono text-[9px] text-[#9b9384]">{m.scale}</div>
                </button>
              ))}
            </div>
          </section>

          {/* Optional Lyria AI Music Composition */}
          <section className="border border-[#f3ece0]/14 bg-[#0f141f] p-4">
            <div className="flex items-center justify-between">
              <div className="font-display text-sm font-bold tracking-wider text-[#7cd7f2] uppercase">
                Lyria Score Composer
              </div>
              <div className="flex gap-1 font-mono text-[10px]">
                <button
                  type="button"
                  onClick={() => setMode('clip')}
                  className={`cursor-pointer border px-2 py-1 uppercase ${
                    mode === 'clip'
                      ? 'border-[#7cd7f2] bg-[#7cd7f2]/15 text-[#9be4fa]'
                      : 'border-[#f3ece0]/15 text-[#9d9587]'
                  }`}
                >
                  30s Clip
                </button>
                <button
                  type="button"
                  onClick={() => setMode('pro')}
                  className={`cursor-pointer border px-2 py-1 uppercase ${
                    mode === 'pro'
                      ? 'border-[#7cd7f2] bg-[#7cd7f2]/15 text-[#9be4fa]'
                      : 'border-[#f3ece0]/15 text-[#9d9587]'
                  }`}
                >
                  Full Pro
                </button>
              </div>
            </div>

            <textarea
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="mt-2.5 w-full resize-none border border-[#f3ece0]/18 bg-[#151c29] p-2.5 text-xs text-[#f3ece0] focus:border-[#7cd7f2] focus:outline-none"
            />

            <button
              type="button"
              disabled={busy}
              onClick={handleGenerateMusic}
              className="mt-2.5 flex w-full cursor-pointer items-center justify-center gap-2 border border-[#7cd7f2]/60 bg-[#122634] px-4 py-2.5 font-mono text-xs font-semibold tracking-wider text-[#9be4fa] uppercase transition hover:border-[#7cd7f2] disabled:opacity-50"
            >
              <Wand2 className="h-3.5 w-3.5" />
              <span>
                {busy
                  ? 'Composing Score...'
                  : mode === 'pro'
                    ? 'Compose Track (Lyria 3 Pro)'
                    : 'Compose Motif (Lyria 3 Clip)'}
              </span>
            </button>

            {error && (
              <p className="mt-2.5 border border-[#e05d5d]/45 bg-[#261317] px-3 py-2 text-xs text-[#f5b4b4]">
                {error}
              </p>
            )}

            {audioDataUrl && (
              <div className="mt-3 space-y-2 border-t border-[#f3ece0]/12 pt-3">
                <div className="font-mono text-[10px] text-[#52c78c] uppercase">
                  Generated via {modelUsed || 'Lyria'}
                </div>
                <audio
                  controls
                  src={audioDataUrl}
                  onPlay={() => onSetDucked(true)}
                  onPause={() => onSetDucked(false)}
                  onEnded={() => onSetDucked(false)}
                  className="w-full"
                />
                {lyrics && (
                  <p className="max-h-24 overflow-y-auto whitespace-pre-wrap text-xs text-[#cfc6b6]">
                    {lyrics}
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
