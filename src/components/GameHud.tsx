import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  Cloud,
  Globe,
  Mic,
  Music,
  Pause,
  Sparkles,
} from 'lucide-react';
import type { DynamicQuest, HudSnapshot, WorldState } from '../game/types';

interface GameHudProps {
  hud: HudSnapshot;
  world: WorldState;
  activeQuest: DynamicQuest | null;
  remotePlayerCount: number;
  isMuted: boolean;
  onOpenQuests: () => void;
  onOpenSoundscape: () => void;
  onOpenVoiceOracle: () => void;
  onOpenWorldAtlas: () => void;
  onOpenCloud: () => void;
  onTogglePause: () => void;
  onInteractShrine: (shrineId: string) => void;
}

export const GameHud: React.FC<GameHudProps> = ({
  hud,
  world,
  activeQuest,
  remotePlayerCount,
  isMuted,
  onOpenQuests,
  onOpenSoundscape,
  onOpenVoiceOracle,
  onOpenWorldAtlas,
  onOpenCloud,
  onTogglePause,
  onInteractShrine,
}) => {
  // Trailing damage ghost bar for tactile hit feedback
  const [ghostHp, setGhostHp] = useState(hud.hp);

  useEffect(() => {
    if (hud.hp < ghostHp) {
      const timer = window.setTimeout(() => setGhostHp(hud.hp), 380);
      return () => window.clearTimeout(timer);
    }
    setGhostHp(hud.hp);
  }, [hud.hp, ghostHp]);

  const hpPct = Math.max(0, Math.min(100, (hud.hp / Math.max(1, hud.maxHp)) * 100));
  const ghostPct = Math.max(0, Math.min(100, (ghostHp / Math.max(1, hud.maxHp)) * 100));
  const resPct = Math.max(0, Math.min(100, hud.resonance));
  const nearShrine = hud.nearestShrine && hud.nearestShrine.distance <= 8.5 ? hud.nearestShrine : null;

  const handleBtnClick = (fn: () => void) => (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    fn();
  };

  return (
    <div
      className="pointer-events-none fixed inset-0 z-10 flex flex-col justify-between p-4 sm:p-5"
      data-testid="game-hud"
    >
      {/* Top Row: Vitality/Stats (Left) + Compact Icon Utility Rail (Right) */}
      <div className="flex items-start justify-between gap-3">
        {/* Top-Left Player Gauges & Objective */}
        <div className="w-60 sm:w-72">
          <div className="border-l-2 border-[#e5a94c] bg-[#101520]/82 px-3.5 py-2.5 shadow-lg">
            {/* HP Header */}
            <div className="flex items-baseline justify-between text-[11px] font-semibold tracking-[0.14em] uppercase">
              <span className="text-[#e8decb]">Vitality</span>
              <span className="font-mono tabular-nums text-[#f5d18c]">
                {hud.hp} / {hud.maxHp}
              </span>
            </div>
            {/* Custom SVG Beveled Vitality Bar with Trailing Ghost */}
            <svg
              viewBox="0 0 220 12"
              className="mt-1 h-2.5 w-full"
              aria-label={`Vitality ${hud.hp} of ${hud.maxHp}`}
            >
              <polygon points="0,0 220,0 214,12 0,12" fill="#222a38" />
              <polygon
                points={`0,0 ${(ghostPct / 100) * 220},0 ${Math.max(0, (ghostPct / 100) * 220 - 4)},12 0,12`}
                fill="#e5a94c"
                fillOpacity="0.65"
              />
              <polygon
                points={`0,0 ${(hpPct / 100) * 220},0 ${Math.max(0, (hpPct / 100) * 220 - 4)},12 0,12`}
                fill={hpPct < 30 ? '#e05d5d' : '#52c78c'}
              />
            </svg>

            {/* Resonance Bar */}
            <div className="mt-2 flex items-baseline justify-between text-[10px] tracking-[0.14em] uppercase">
              <span className="text-[#a8b6c8]">Resonance</span>
              <span className="font-mono tabular-nums text-[#7cd7f2]">{hud.resonance}</span>
            </div>
            <svg
              viewBox="0 0 220 8"
              className="mt-0.5 h-1.5 w-full"
              aria-label={`Resonance ${hud.resonance}`}
            >
              <polygon points="0,0 220,0 216,8 0,8" fill="#1e2736" />
              <polygon
                points={`0,0 ${(resPct / 100) * 220},0 ${Math.max(0, (resPct / 100) * 220 - 3)},8 0,8`}
                fill="#5ec9e8"
              />
            </svg>

            {/* Integer Progression Telemetry */}
            <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-[#f3ece0]/12 pt-2 font-mono text-[11px] tabular-nums">
              <div>
                <div className="text-[9px] tracking-widest text-[#9d9587] uppercase">LVL</div>
                <div className="font-semibold text-[#f3ece0]">{hud.level}</div>
              </div>
              <div>
                <div className="text-[9px] tracking-widest text-[#9d9587] uppercase">SHARDS</div>
                <div className="font-semibold text-[#e5a94c]">{hud.shards}</div>
              </div>
              <div>
                <div className="text-[9px] tracking-widest text-[#9d9587] uppercase">STABILITY</div>
                <div className="font-semibold text-[#7cd7f2]">{Math.round(world.stability)}%</div>
              </div>
            </div>
          </div>

          {/* Active Quest Compact Strip */}
          {activeQuest && (
            <button
              type="button"
              tabIndex={-1}
              onClick={handleBtnClick(onOpenQuests)}
              className="pointer-events-auto mt-2 flex w-full cursor-pointer items-center justify-between gap-2 border-l-2 border-[#7cd7f2] bg-[#101520]/80 px-3 py-1.5 text-left transition hover:bg-[#171f2e]"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.14em] text-[#7cd7f2] uppercase">
                  <Sparkles className="h-3 w-3 shrink-0" />
                  <span>{activeQuest.status === 'active' ? 'Active Quest [Q]' : 'Quest Complete [Q]'}</span>
                </div>
                <div className="truncate text-xs font-medium text-[#f3ece0]">
                  {activeQuest.title}
                </div>
              </div>
              <span className="shrink-0 font-mono text-[10px] text-[#e5a94c]">
                {world.completedQuests}/3
              </span>
            </button>
          )}
        </div>

        {/* Top-Right Compact Utility Icon Rail */}
        <div className="pointer-events-auto flex flex-col items-end gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              tabIndex={-1}
              aria-label="Open Quests and Vector Memory"
              title="Quests & Vector Memory (Q)"
              onClick={handleBtnClick(onOpenQuests)}
              className="flex h-10 w-10 cursor-pointer items-center justify-center border border-[#f3ece0]/22 bg-[#101520]/85 text-[#f3ece0] transition hover:border-[#e5a94c] hover:text-[#e5a94c]"
            >
              <BookOpen className="h-4 w-4" />
            </button>

            <button
              type="button"
              tabIndex={-1}
              aria-label="Open World Atlas Map"
              title="World Atlas Map (G)"
              onClick={handleBtnClick(onOpenWorldAtlas)}
              className="flex h-10 w-10 cursor-pointer items-center justify-center border border-[#f3ece0]/22 bg-[#101520]/85 text-[#f3ece0] transition hover:border-[#e5a94c] hover:text-[#e5a94c]"
            >
              <Globe className="h-4 w-4" />
            </button>

            <button
              type="button"
              tabIndex={-1}
              aria-label="Open Adaptive Soundscape"
              title="Soundscape & Lyria Music (M)"
              onClick={handleBtnClick(onOpenSoundscape)}
              className={`flex h-10 w-10 cursor-pointer items-center justify-center border bg-[#101520]/85 transition hover:border-[#e5a94c] hover:text-[#e5a94c] ${
                isMuted ? 'border-[#e05d5d]/50 text-[#e05d5d]' : 'border-[#f3ece0]/22 text-[#f3ece0]'
              }`}
            >
              <Music className="h-4 w-4" />
            </button>

            <button
              type="button"
              tabIndex={-1}
              aria-label="Open Voice Oracle"
              title="Live Voice Oracle (V)"
              onClick={handleBtnClick(onOpenVoiceOracle)}
              className="flex h-10 w-10 cursor-pointer items-center justify-center border border-[#f3ece0]/22 bg-[#101520]/85 text-[#f3ece0] transition hover:border-[#e5a94c] hover:text-[#e5a94c]"
            >
              <Mic className="h-4 w-4" />
            </button>

            <button
              type="button"
              tabIndex={-1}
              aria-label="Open Cloud Sync and Multiplayer"
              title="Cloud Sync & Multiplayer (C)"
              onClick={handleBtnClick(onOpenCloud)}
              className="relative flex h-10 w-10 cursor-pointer items-center justify-center border border-[#f3ece0]/22 bg-[#101520]/85 text-[#f3ece0] transition hover:border-[#e5a94c] hover:text-[#e5a94c]"
            >
              <Cloud className="h-4 w-4" />
              {remotePlayerCount > 0 && (
                <span className="absolute -right-1 -bottom-1 bg-[#52c78c] px-1 font-mono text-[9px] font-bold text-[#101520]">
                  {remotePlayerCount}
                </span>
              )}
            </button>

            <button
              type="button"
              tabIndex={-1}
              aria-label="Pause Game"
              title="Pause (Esc / P)"
              onClick={handleBtnClick(onTogglePause)}
              className="flex h-10 w-10 cursor-pointer items-center justify-center border border-[#f3ece0]/22 bg-[#101520]/85 text-[#f3ece0] transition hover:border-[#e5a94c] hover:text-[#e5a94c]"
            >
              <Pause className="h-4 w-4" />
            </button>
          </div>

          {/* Minimal Coordinate & Biome Tag */}
          <div className="hidden text-right font-mono text-[10px] tracking-wider text-[#e8decb]/85 sm:block hud-text-shadow">
            <div>{hud.biomeName}</div>
            <div className="tabular-nums text-[#c7beae]">
              POS ({hud.playerX}, {hud.playerZ}) · KO {hud.defeatedCount}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Row: Contextual Shrine Prompt + Combat Ability Readout */}
      <div className="flex flex-col items-center gap-2 pb-1">
        {nearShrine && (
          <button
            type="button"
            tabIndex={-1}
            onClick={handleBtnClick(() => onInteractShrine(nearShrine.id))}
            className="pointer-events-auto cursor-pointer border border-[#e5a94c] bg-[#101520]/92 px-4 py-2 text-xs font-semibold tracking-[0.14em] text-[#f5d18c] uppercase shadow-xl transition hover:bg-[#1a2232]"
          >
            [E] Commune with {nearShrine.name}
          </button>
        )}

        <div className="hidden items-center gap-4 text-[11px] font-medium tracking-[0.14em] uppercase sm:flex hud-text-shadow">
          <span className={hud.dashReady ? 'text-[#7cd7f2]' : 'text-[#7c8491]'}>
            [Shift] Dash {hud.dashReady ? 'Ready' : 'Charging'}
          </span>
          <span className="text-[#f3ece0]/30">·</span>
          <span className={hud.strikeReady ? 'text-[#e5a94c]' : 'text-[#7c8491]'}>
            [F] Resonance Strike {hud.strikeReady ? 'Ready' : 'Charging'}
          </span>
          <span className="text-[#f3ece0]/30">·</span>
          <span className="text-[#d6cec0]">[Q] Quests · [G] Atlas · [M] Audio</span>
        </div>
      </div>
    </div>
  );
};
