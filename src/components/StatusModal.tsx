import React from 'react';
import { Award, Play, RotateCcw, ShieldAlert } from 'lucide-react';
import type { GeoPlayerState } from '../game/geoEngine';
import type { GamePhase } from '../game/types';

interface StatusModalProps {
  phase: GamePhase;
  sectorName: string;
  player: GeoPlayerState;
  capturedCount: number;
  targetCaptures: number;
  memoryCount: number;
  onResume: () => void;
  onRestart: () => void;
  onReturnTitle: () => void;
}

export const StatusModal: React.FC<StatusModalProps> = ({
  phase,
  sectorName,
  player,
  capturedCount,
  targetCaptures,
  memoryCount,
  onResume,
  onRestart,
  onReturnTitle,
}) => {
  if (phase === 'title' || phase === 'playing') return null;

  const isVictory = phase === 'victory';
  const isDefeat = phase === 'gameover';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isVictory ? 'Sector Secured' : isDefeat ? 'Signal Lost' : 'Operation Paused'}
      className="fixed inset-0 z-40 flex items-center justify-center bg-[#090d14]/82 p-4"
    >
      <div className="w-full max-w-md border border-[#e5a94c]/45 bg-[#101622] p-6 text-[#f2ece1] shadow-2xl">
        <div className="flex items-center gap-3">
          {isVictory ? (
            <Award className="h-6 w-6 text-[#e5a94c]" />
          ) : isDefeat ? (
            <ShieldAlert className="h-6 w-6 text-rose-400" />
          ) : (
            <Play className="h-6 w-6 text-[#e5a94c]" />
          )}
          <div>
            <h2 className="font-display text-xl font-bold tracking-[0.12em] uppercase">
              {isVictory ? 'Sector Secured' : isDefeat ? 'Signal Lost' : 'Paused'}
            </h2>
            <p className="text-xs text-[#9aa5b8]">{sectorName}</p>
          </div>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-[#cfd7e5]">
          {isVictory
            ? 'You claimed enough real-world landmarks to stabilize this city sector. Continue exploring here or jump to another city anywhere on Earth.'
            : isDefeat
              ? 'Patrolling Hunters disrupted your runner integrity before the sector could be secured. Redeploy to try a new street route.'
              : 'Simulation and active patrols are suspended while paused.'}
        </p>

        {/* Mastery / Progress Metrics */}
        <div className="mt-5 grid grid-cols-3 gap-2 border-y border-[#f2ece1]/12 py-3.5 text-center">
          <div>
            <div className="text-[11px] text-[#95a0b3]">Score</div>
            <div className="mt-0.5 font-mono text-lg font-bold text-[#f7dca2] tabular-nums">
              {Math.round(player.score)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#95a0b3]">Claimed</div>
            <div className="mt-0.5 font-mono text-lg font-bold text-[#f2ece1] tabular-nums">
              {capturedCount}/{targetCaptures}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#95a0b3]">Distance</div>
            <div className="mt-0.5 font-mono text-lg font-bold text-[#9ddcf7] tabular-nums">
              {(player.distanceTraveledMeters / 1000).toFixed(2)} km
            </div>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between text-xs text-[#9aa5b8] tabular-nums">
          <span>Hunters Neutralized: {player.huntersNeutralized}</span>
          <span>Memories Recorded: {memoryCount}</span>
        </div>

        {/* Actions */}
        <div className="mt-5 flex flex-col gap-2">
          {!isDefeat && (
            <button
              type="button"
              data-start={isVictory ? 'true' : undefined}
              onClick={onResume}
              className="flex w-full cursor-pointer items-center justify-center gap-2 border border-[#f7da9c] bg-[#e5a94c] px-4 py-2.5 font-display text-xs font-bold tracking-[0.16em] text-[#0c111b] uppercase transition hover:bg-[#f2be68]"
            >
              <Play className="h-3.5 w-3.5" />
              <span>{isVictory ? 'Continue Free Roam' : 'Resume'}</span>
            </button>
          )}

          <button
            type="button"
            data-start={isDefeat ? 'true' : undefined}
            onClick={onRestart}
            className={`flex w-full cursor-pointer items-center justify-center gap-2 border px-4 py-2.5 font-display text-xs font-bold tracking-[0.16em] uppercase transition ${
              isDefeat
                ? 'border-[#f7da9c] bg-[#e5a94c] text-[#0c111b] hover:bg-[#f2be68]'
                : 'border-[#f2ece1]/20 bg-[#161f30] text-[#e7ecf5] hover:border-[#e5a94c]'
            }`}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>{isDefeat ? 'Try Again' : 'Restart Sector'}</span>
          </button>

          <button
            type="button"
            onClick={onReturnTitle}
            className="w-full cursor-pointer border border-[#f2ece1]/14 bg-transparent px-4 py-2 text-xs font-medium text-[#b5bece] transition hover:border-[#f2ece1]/40 hover:text-white"
          >
            Change City / Title
          </button>
        </div>
      </div>
    </div>
  );
};
