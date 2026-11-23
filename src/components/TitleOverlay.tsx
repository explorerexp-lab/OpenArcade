import React from 'react';
import type { User } from 'firebase/auth';
import { LogIn, Navigation } from 'lucide-react';
import type { LatLngLiteral } from '../game/geoEngine';
import { PlaceSearchBar } from './PlaceSearchBar';

interface TitleOverlayProps {
  sectorName: string;
  realPlacesCount: number;
  user: User | null;
  authBusy: boolean;
  authError: string | null;
  memoryCount: number;
  onSelectDestination: (center: LatLngLiteral, label: string) => void;
  onStart: () => void;
  onSignIn: () => void;
}

export const TitleOverlay: React.FC<TitleOverlayProps> = ({
  sectorName,
  realPlacesCount,
  user,
  authBusy,
  authError,
  memoryCount,
  onSelectDestination,
  onStart,
  onSignIn,
}) => {
  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-4 pb-9 sm:p-8 sm:pb-9">
      {/* Subtle left-side scrim so title panel reads cleanly while right 60%+ showcases the live Google Map */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-y-0 left-0 w-full max-w-[540px] bg-gradient-to-r from-[#0b1019]/96 via-[#0b1019]/88 to-transparent"
      />

      {/* Top-left Brand & Deployment Panel */}
      <div className="pointer-events-auto relative z-10 my-auto w-full max-w-[440px] border border-[#e5a94c]/35 bg-[#0d131f]/95 p-6 shadow-2xl">
        {/* Custom Inline SVG Compass-Astrolabe Emblem + Title Lockup */}
        <div className="flex items-center gap-3.5">
          <svg
            viewBox="0 0 44 44"
            className="h-11 w-11 shrink-0 text-[#e5a94c]"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="22" cy="22" r="19" stroke="currentColor" strokeWidth="1.5" opacity="0.65" />
            <circle cx="22" cy="22" r="12" stroke="currentColor" strokeWidth="1.2" opacity="0.4" />
            <path d="M22 2v8M22 34v8M2 22h8M34 22h8" stroke="currentColor" strokeWidth="1.5" />
            <polygon points="22,8 27,22 22,36 17,22" fill="currentColor" opacity="0.92" />
            <circle cx="22" cy="22" r="3" fill="#0d131f" />
          </svg>
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold tracking-[0.14em] text-[#f7eedb] uppercase">
              Aethern
            </h1>
            <p className="text-xs font-medium text-[#b5bece]">
              Real-World Map Strategy & Extraction
            </p>
          </div>
        </div>

        {/* Concise Operational Briefing */}
        <p className="mt-4 text-sm leading-relaxed text-[#d4dce8]">
          Play directly on real city streets. Route through live landmarks, outmaneuver patrolling
          Hunters with EMP pulses, inspect Street View recon, and claim 5 real places to secure the
          sector.
        </p>

        {/* Active Sector Readout (unboxed metadata with clean separators) */}
        <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-y border-[#f2ece1]/12 py-2.5 text-xs text-[#b8c1d1]">
          <span className="font-semibold text-[#f3cf87]">{sectorName}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">
            {realPlacesCount > 0 ? `${realPlacesCount} real places scanned` : 'Ready to scan'}
          </span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{memoryCount} memories</span>
        </div>

        {/* Real-World City Search, GPS & Quick Drop Selector */}
        <div className="mt-4">
          <PlaceSearchBar
            activeSectorName={sectorName}
            onSelectDestination={onSelectDestination}
          />
        </div>

        {/* Primary Action & Optional Cloud Sign-In (<= 2 actions total) */}
        <div className="mt-5 flex flex-col gap-2.5">
          <button
            type="button"
            data-start="true"
            onClick={(e) => {
              e.currentTarget.blur();
              onStart();
            }}
            className="flex w-full cursor-pointer items-center justify-center gap-2 border border-[#f7da9c] bg-[#e5a94c] px-5 py-3 font-display text-sm font-bold tracking-[0.16em] text-[#0c111b] uppercase transition hover:bg-[#f2bc66] whitespace-nowrap"
          >
            <Navigation className="h-4 w-4" />
            <span>Deploy to Map</span>
          </button>

          {!user ? (
            <button
              type="button"
              disabled={authBusy}
              onClick={onSignIn}
              className="flex w-full cursor-pointer items-center justify-center gap-2 border border-[#f2ece1]/20 bg-[#141c2b] px-4 py-2.5 text-xs font-semibold text-[#dce2ed] transition hover:border-[#e5a94c]/60 hover:text-white disabled:opacity-50 whitespace-nowrap"
            >
              <LogIn className="h-3.5 w-3.5 text-[#e5a94c]" />
              <span>{authBusy ? 'Signing in...' : 'Sign in with Google for Cloud Sync'}</span>
            </button>
          ) : (
            <div className="text-center text-xs text-[#9aa6ba]">
              Signed in as <span className="font-semibold text-[#f2ece1]">{user.displayName || user.email}</span>
            </div>
          )}

          {authError && <p className="text-xs text-rose-300">{authError}</p>}
        </div>
      </div>

      {/* Single flat borderless control hint line in bottom safe margin */}
      <div className="relative z-10 text-xs text-[#b5bece] hud-text-shadow">
        Click any Place or Street to Route · WASD Steer · Space EMP Pulse · Shift Overdrive · E Claim
      </div>
    </div>
  );
};
