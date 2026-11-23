import React, { useState } from 'react';
import {
  Cloud,
  Compass,
  Crosshair,
  Eye,
  Flag,
  Map as MapIcon,
  Pause,
  Radar,
  ScrollText,
  Search,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import {
  CLAIM_RADIUS_METERS,
  PULSE_ENERGY_COST,
  haversineMeters,
  type ActiveRouteState,
  type GeoPlayerState,
  type LatLngLiteral,
  type MapLandmarkNode,
} from '../game/geoEngine';
import type { DynamicQuest, WorldState } from '../game/types';
import type { TacticalMapStyle } from './RealMapArena';
import { PlaceSearchBar } from './PlaceSearchBar';

interface GameHudProps {
  sectorName: string;
  player: GeoPlayerState;
  nodes: MapLandmarkNode[];
  capturedCount: number;
  targetCaptures: number;
  threatLevel: number;
  activeRoute: ActiveRouteState | null;
  selectedNode: MapLandmarkNode | null;
  nearestUnclaimedNode: { node: MapLandmarkNode; distance: number } | null;
  world: WorldState;
  activeQuest: DynamicQuest | null;
  remotePlayerCount: number;
  mapStyle: TacticalMapStyle;
  isMuted: boolean;
  onChangeMapStyle: (style: TacticalMapStyle) => void;
  onSelectDestination: (center: LatLngLiteral, label: string) => void;
  onRescanSector: () => void;
  onRecenter: () => void;
  onTriggerPulse: () => void;
  onToggleOverdrive: () => void;
  onClaimNode: (node: MapLandmarkNode) => void;
  onOpenStreetView: (node: MapLandmarkNode) => void;
  onRouteToNode: (node: MapLandmarkNode) => void;
  onOpenQuests: () => void;
  onOpenSoundscape: () => void;
  onOpenCloud: () => void;
  onTogglePause: () => void;
}

export const GameHud: React.FC<GameHudProps> = ({
  sectorName,
  player,
  capturedCount,
  targetCaptures,
  threatLevel,
  activeRoute,
  selectedNode,
  nearestUnclaimedNode,
  remotePlayerCount,
  mapStyle,
  isMuted,
  onChangeMapStyle,
  onSelectDestination,
  onRescanSector,
  onRecenter,
  onTriggerPulse,
  onToggleOverdrive,
  onClaimNode,
  onOpenStreetView,
  onRouteToNode,
  onOpenQuests,
  onOpenSoundscape,
  onOpenCloud,
  onTogglePause,
}) => {
  const [cityPickerOpen, setCityPickerOpen] = useState(false);

  const hpPct = Math.max(0, Math.min(100, (player.integrity / player.maxIntegrity) * 100));
  const energyPct = Math.max(0, Math.min(100, (player.energy / player.maxEnergy) * 100));
  const pulseReady = player.pulseCooldown <= 0.05 && player.energy >= PULSE_ENERGY_COST;

  const focusNode = selectedNode ?? nearestUnclaimedNode?.node ?? null;
  const focusDist = focusNode
    ? Math.round(haversineMeters(player.position, focusNode.position))
    : null;
  const canClaimFocus = Boolean(
    focusNode && !focusNode.captured && focusDist !== null && focusDist <= CLAIM_RADIUS_METERS
  );

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-3 pb-8 sm:p-4 sm:pb-7">
      {/* Subtle critical-integrity edge warning */}
      {hpPct <= 35 && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 border-4 border-rose-500/55"
        />
      )}

      {/* TOP PERIMETER ROW */}
      <div className="flex items-start justify-between gap-2">
        {/* Top-Left Compact Telemetry Cluster */}
        <div className="pointer-events-auto w-[212px] sm:w-[276px] border border-[#f2ece1]/18 bg-[#0c111b]/94 px-3 py-2 sm:px-3.5 sm:py-2.5 shadow-xl">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-xs font-semibold text-[#f3cf87]">{sectorName}</span>
            <span className="shrink-0 font-mono text-[11px] font-semibold text-[#d5dce8] tabular-nums">
              {capturedCount}/{targetCaptures} Claimed
            </span>
          </div>

          {/* Integrity & Energy Bars */}
          <div className="mt-2 space-y-1.5">
            <div>
              <div className="mb-0.5 flex items-center justify-between text-[11px]">
                <span className="text-[#aeb7c7]">Integrity</span>
                <span className="font-mono font-semibold text-[#f2ece1] tabular-nums">
                  {Math.round(player.integrity)}/{Math.round(player.maxIntegrity)}
                  {threatLevel > 0.45 ? ' · ALERT' : ''}
                </span>
              </div>
              <div className="h-1.5 w-full bg-[#1d2638]">
                <div
                  className="h-full transition-all duration-150"
                  style={{
                    width: `${hpPct}%`,
                    backgroundColor: hpPct > 35 ? '#34d399' : '#ef4444',
                  }}
                />
              </div>
            </div>

            <div>
              <div className="mb-0.5 flex items-center justify-between text-[11px]">
                <span className="text-[#aeb7c7]">Energy</span>
                <span className="font-mono font-semibold text-[#9ddcf7] tabular-nums">
                  {Math.round(player.energy)}%
                </span>
              </div>
              <div className="h-1.5 w-full bg-[#1d2638]">
                <div
                  className="h-full bg-[#38bdf8] transition-all duration-150"
                  style={{ width: `${energyPct}%` }}
                />
              </div>
            </div>
          </div>

          {/* Clean unboxed inline stats */}
          <div className="mt-2 flex items-center justify-between border-t border-[#f2ece1]/10 pt-1.5 font-mono text-[11px] text-[#c7d0df] tabular-nums">
            <span>Score {Math.round(player.score)}</span>
            <span aria-hidden="true">·</span>
            <span>{Math.round(player.shards)} Shards</span>
            <span aria-hidden="true">·</span>
            <span>{(player.distanceTraveledMeters / 1000).toFixed(2)} km</span>
          </div>
        </div>

        {/* Top-Right Compact Utility Cluster */}
        <div className="pointer-events-auto flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {/* Map Style Segmented Switcher */}
            <div
              role="group"
              aria-label="Map layer style"
              className="hidden sm:flex items-center border border-[#f2ece1]/18 bg-[#0c111b]/94 p-0.5"
            >
              {(['dark', 'hybrid', 'terrain'] as TacticalMapStyle[]).map((styleKey) => (
                <button
                  key={styleKey}
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onChangeMapStyle(styleKey);
                  }}
                  className={`cursor-pointer px-2.5 py-1 text-[11px] font-medium capitalize transition whitespace-nowrap ${
                    mapStyle === styleKey
                      ? 'bg-[#e5a94c] text-[#0c111b] font-semibold'
                      : 'text-[#c3ccdc] hover:text-white'
                  }`}
                >
                  {styleKey === 'dark' ? 'Tactical' : styleKey === 'hybrid' ? 'Satellite' : 'Terrain'}
                </button>
              ))}
            </div>

            {/* Quick City Teleport Toggle */}
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                setCityPickerOpen((o) => !o);
              }}
              aria-label="Jump to another city"
              className={`flex h-9 cursor-pointer items-center gap-1.5 border px-2.5 text-xs font-medium transition whitespace-nowrap ${
                cityPickerOpen
                  ? 'border-[#e5a94c] bg-[#e5a94c] text-[#0c111b]'
                  : 'border-[#f2ece1]/20 bg-[#0c111b]/94 text-[#e7ecf5] hover:border-[#e5a94c]'
              }`}
            >
              <Search className="h-3.5 w-3.5" />
              <span className="hidden md:inline">City</span>
            </button>

            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onRescanSector();
              }}
              aria-label="Rescan nearby real places"
              title="Rescan nearby real places"
              className="flex h-9 w-9 cursor-pointer items-center justify-center border border-[#f2ece1]/20 bg-[#0c111b]/94 text-[#e7ecf5] transition hover:border-[#e5a94c] hover:text-[#f3cf87]"
            >
              <Radar className="h-4 w-4" />
            </button>

            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onRecenter();
              }}
              aria-label="Center map on runner"
              title="Center on Runner"
              className="flex h-9 w-9 cursor-pointer items-center justify-center border border-[#f2ece1]/20 bg-[#0c111b]/94 text-[#e7ecf5] transition hover:border-[#e5a94c] hover:text-[#f3cf87]"
            >
              <Crosshair className="h-4 w-4" />
            </button>

            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenQuests();
              }}
              aria-label="Open Quests and Vector Memory (Q)"
              title="Quests & Memory (Q)"
              className="flex h-9 w-9 cursor-pointer items-center justify-center border border-[#f2ece1]/20 bg-[#0c111b]/94 text-[#e7ecf5] transition hover:border-[#e5a94c] hover:text-[#f3cf87]"
            >
              <ScrollText className="h-4 w-4" />
            </button>

            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenSoundscape();
              }}
              aria-label="Open Soundscape (M)"
              title="Soundscape (M)"
              className="flex h-9 w-9 cursor-pointer items-center justify-center border border-[#f2ece1]/20 bg-[#0c111b]/94 text-[#e7ecf5] transition hover:border-[#e5a94c] hover:text-[#f3cf87]"
            >
              {isMuted ? <VolumeX className="h-4 w-4 text-rose-300" /> : <Volume2 className="h-4 w-4" />}
            </button>

            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenCloud();
              }}
              aria-label="Open Cloud Sync & Multiplayer (C)"
              title={`Cloud & Multiplayer (${remotePlayerCount} nearby)`}
              className="flex h-9 w-9 cursor-pointer items-center justify-center border border-[#f2ece1]/20 bg-[#0c111b]/94 text-[#e7ecf5] transition hover:border-[#e5a94c] hover:text-[#f3cf87]"
            >
              <Cloud className="h-4 w-4" />
            </button>

            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onTogglePause();
              }}
              aria-label="Pause Game (Esc)"
              title="Pause (Esc)"
              className="flex h-9 w-9 cursor-pointer items-center justify-center border border-[#f2ece1]/20 bg-[#0c111b]/94 text-[#e7ecf5] transition hover:border-[#e5a94c] hover:text-[#f3cf87]"
            >
              <Pause className="h-4 w-4" />
            </button>
          </div>

          {/* Collapsible In-Game City Switcher Popover */}
          {cityPickerOpen && (
            <div className="w-[310px] sm:w-[370px] border border-[#e5a94c]/40 bg-[#0d131f]/98 p-3.5 shadow-2xl">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-[#f3cf87]">
                  Jump to Any City on Earth
                </span>
                <button
                  type="button"
                  onClick={() => setCityPickerOpen(false)}
                  className="cursor-pointer text-xs text-[#9aa5b8] hover:text-white"
                >
                  Close
                </button>
              </div>
              <PlaceSearchBar
                activeSectorName={sectorName}
                compact
                onSelectDestination={(center, label) => {
                  onSelectDestination(center, label);
                  setCityPickerOpen(false);
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* BOTTOM TACTICAL DOCK */}
      <div className="flex flex-wrap items-end justify-between gap-2.5">
        {/* Selected / Nearest Real Landmark Info Strip */}
        <div className="pointer-events-auto min-w-[240px] max-w-[440px] flex-1 border border-[#f2ece1]/18 bg-[#0c111b]/94 px-3.5 py-2.5 shadow-xl">
          {focusNode ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[11px] text-[#9aa6ba]">
                  <span className="capitalize font-semibold text-[#e5a94c]">{focusNode.kind}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">{focusDist}m away</span>
                  {activeRoute && activeRoute.targetNodeId === focusNode.id && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-[#7dd3fc] tabular-nums">
                        {activeRoute.isRealStreetRoute ? 'Street Route' : 'Direct'} ·{' '}
                        {Math.max(0, Math.round(activeRoute.totalMeters - activeRoute.traveledMeters))}m left
                      </span>
                    </>
                  )}
                </div>
                <div className="truncate text-sm font-semibold text-[#f7f1e5]">
                  {focusNode.name}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onOpenStreetView(focusNode);
                  }}
                  className="flex h-9 cursor-pointer items-center gap-1.5 border border-[#f2ece1]/20 bg-[#151e30] px-2.5 text-xs font-medium text-[#dce4f2] transition hover:border-[#e5a94c] hover:text-white whitespace-nowrap"
                >
                  <Eye className="h-3.5 w-3.5 text-[#e5a94c]" />
                  <span>Street View</span>
                </button>

                {canClaimFocus ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onClaimNode(focusNode);
                    }}
                    className="flex h-9 cursor-pointer items-center gap-1.5 border border-[#f7da9c] bg-[#e5a94c] px-3 text-xs font-bold text-[#0c111b] transition hover:bg-[#f2be68] whitespace-nowrap"
                  >
                    <Flag className="h-3.5 w-3.5" />
                    <span>Claim [E]</span>
                  </button>
                ) : !focusNode.captured ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onRouteToNode(focusNode);
                    }}
                    className="flex h-9 cursor-pointer items-center gap-1.5 border border-[#38bdf8]/60 bg-[#0f2438] px-3 text-xs font-semibold text-[#bae6fd] transition hover:bg-[#173654] whitespace-nowrap"
                  >
                    <MapIcon className="h-3.5 w-3.5" />
                    <span>Route Here</span>
                  </button>
                ) : (
                  <span className="px-2 text-xs font-semibold text-emerald-300">Captured</span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-[#b5bece]">
              <Compass className="h-4 w-4 text-[#e5a94c]" />
              <span>Click any landmark pin or road on the map to route your Runner.</span>
            </div>
          )}
        </div>

        {/* Tactical Action Buttons (EMP Pulse & Overdrive) */}
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            tabIndex={-1}
            disabled={!pulseReady}
            onClick={(e) => {
              e.currentTarget.blur();
              onTriggerPulse();
            }}
            className={`flex h-11 cursor-pointer items-center gap-2 border px-4 text-xs font-bold transition whitespace-nowrap ${
              pulseReady
                ? 'border-[#38bdf8] bg-[#0e2a40] text-[#e0f2fe] hover:bg-[#153e5e]'
                : 'border-[#f2ece1]/15 bg-[#0c111b]/90 text-[#7d889c] cursor-not-allowed'
            }`}
          >
            <Zap className="h-4 w-4 text-[#38bdf8]" />
            <span className="tabular-nums">
              {player.pulseCooldown > 0.05
                ? `EMP ${player.pulseCooldown.toFixed(1)}s`
                : 'EMP Pulse [Space]'}
            </span>
          </button>

          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleOverdrive();
            }}
            className={`flex h-11 cursor-pointer items-center gap-2 border px-3.5 text-xs font-semibold transition whitespace-nowrap ${
              player.overdriveActive
                ? 'border-[#e5a94c] bg-[#e5a94c] text-[#0c111b]'
                : 'border-[#f2ece1]/20 bg-[#0c111b]/94 text-[#e2e8f2] hover:border-[#e5a94c]'
            }`}
          >
            <span>Overdrive [Shift]</span>
          </button>
        </div>
      </div>
    </div>
  );
};
