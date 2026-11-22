import React from 'react';
import type { GamePhase, HudSnapshot, WorldState } from '../game/types';

interface StatusModalProps {
  phase: GamePhase;
  hud: HudSnapshot;
  world: WorldState;
  memoryCount: number;
  onResume: () => void;
  onRestart: () => void;
  onReturnTitle: () => void;
}

export const StatusModal: React.FC<StatusModalProps> = ({
  phase,
  hud,
  world,
  memoryCount,
  onResume,
  onRestart,
  onReturnTitle,
}) => {
  if (phase !== 'paused' && phase !== 'gameover' && phase !== 'victory') {
    return null;
  }

  const isPaused = phase === 'paused';
  const isVictory = phase === 'victory';

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-[#0c1018]/78 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={isPaused ? 'Game Paused' : isVictory ? 'Realm Harmonized' : 'Wayfarer Fallen'}
    >
      <div className="w-full max-w-md border border-[#e5a94c]/45 bg-[#131924] p-7 text-[#f3ece0] shadow-2xl">
        <div className="font-mono text-[11px] tracking-[0.24em] text-[#e5a94c] uppercase">
          {world.realmName}
        </div>
        <h2 className="mt-1 font-display text-3xl font-bold tracking-[0.12em] uppercase">
          {isPaused ? 'Paused' : isVictory ? 'Sanctuary Harmonized' : 'Resonance Broken'}
        </h2>
        <p className="mt-2.5 text-sm leading-relaxed text-[#cfc6b6]">
          {isPaused
            ? 'The highland winds hold still. Resume your journey or recalibrate the realm.'
            : isVictory
              ? 'You have resolved three emergent shrine decrees and woven a lasting imprint into the Living Atlas.'
              : 'The obsidian sentinels overwhelmed your resonance. Rise again at the central astrolabe.'}
        </p>

        {/* Frozen Snapshot Mastery Telemetry */}
        <div className="mt-5 grid grid-cols-2 gap-3 border-y border-[#f3ece0]/15 py-4 font-mono text-xs tabular-nums">
          <div>
            <div className="text-[10px] tracking-widest text-[#9d9587] uppercase">Shards</div>
            <div className="mt-0.5 text-lg font-semibold text-[#e5a94c]">{hud.shards}</div>
          </div>
          <div>
            <div className="text-[10px] tracking-widest text-[#9d9587] uppercase">Quests Resolved</div>
            <div className="mt-0.5 text-lg font-semibold text-[#52c78c]">{world.completedQuests}</div>
          </div>
          <div>
            <div className="text-[10px] tracking-widest text-[#9d9587] uppercase">Sentinels Felled</div>
            <div className="mt-0.5 text-lg font-semibold text-[#f3ece0]">{hud.defeatedCount}</div>
          </div>
          <div>
            <div className="text-[10px] tracking-widest text-[#9d9587] uppercase">Vector Memories</div>
            <div className="mt-0.5 text-lg font-semibold text-[#7cd7f2]">{memoryCount}</div>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2.5">
          {isPaused || isVictory ? (
            <button
              type="button"
              onClick={onResume}
              className="w-full cursor-pointer border border-[#f5d18c] bg-[#e5a94c] px-5 py-3 font-display text-xs font-bold tracking-[0.2em] text-[#101520] uppercase transition hover:bg-[#f2be6a]"
            >
              {isVictory ? 'Continue Exploring' : 'Resume Journey'}
            </button>
          ) : (
            <button
              type="button"
              data-start="true"
              onClick={onRestart}
              className="w-full cursor-pointer border border-[#f5d18c] bg-[#e5a94c] px-5 py-3 font-display text-xs font-bold tracking-[0.2em] text-[#101520] uppercase transition hover:bg-[#f2be6a]"
            >
              Try Again
            </button>
          )}

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={onRestart}
              className="cursor-pointer border border-[#f3ece0]/25 bg-[#1a2230] px-4 py-2.5 text-xs font-semibold tracking-[0.14em] text-[#f3ece0] uppercase transition hover:border-[#e5a94c]"
            >
              New Realm
            </button>
            <button
              type="button"
              onClick={onReturnTitle}
              className="cursor-pointer border border-[#f3ece0]/25 bg-[#1a2230] px-4 py-2.5 text-xs font-semibold tracking-[0.14em] text-[#f3ece0] uppercase transition hover:border-[#e5a94c]"
            >
              Title Screen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
