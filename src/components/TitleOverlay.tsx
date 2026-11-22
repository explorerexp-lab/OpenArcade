import React from 'react';
import type { User } from 'firebase/auth';
import { LogIn, Compass } from 'lucide-react';

interface TitleOverlayProps {
  realmName: string;
  user: User | null;
  authBusy: boolean;
  authError: string | null;
  memoryCount: number;
  onStart: () => void;
  onSignIn: () => void;
}

export const TitleOverlay: React.FC<TitleOverlayProps> = ({
  realmName,
  user,
  authBusy,
  authError,
  memoryCount,
  onStart,
  onSignIn,
}) => {
  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-6 sm:p-10 md:p-14">
      {/* Subtle left atmospheric scrim for crisp contrast against sunlit sky */}
      <div
        className="pointer-events-none fixed inset-y-0 left-0 w-full max-w-2xl"
        style={{
          background:
            'linear-gradient(90deg, rgba(13, 18, 28, 0.84) 0%, rgba(13, 18, 28, 0.45) 58%, rgba(13, 18, 28, 0) 100%)',
        }}
      />

      {/* Top minimal realm coordinate line */}
      <div className="relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-2.5 text-xs font-medium tracking-[0.22em] text-[#e8dcc6]/85 uppercase hud-text-shadow">
          <Compass className="h-3.5 w-3.5 text-[#e5a94c]" />
          <span>{realmName}</span>
        </div>
        {user && (
          <div className="border border-[#e5a94c]/35 bg-[#121722]/85 px-3 py-1 text-xs text-[#e8dcc6]">
            {user.displayName || user.email}
          </div>
        )}
      </div>

      {/* Asymmetric Left-Third Hero Lockup */}
      <div className="relative z-10 my-auto max-w-lg">
        {/* Bespoke inline SVG Astrolabe Crest & Display Title */}
        <div className="mb-4 flex items-center gap-3">
          <svg
            width="42"
            height="42"
            viewBox="0 0 48 48"
            fill="none"
            aria-hidden="true"
            className="shrink-0"
          >
            <circle cx="24" cy="24" r="20" stroke="#e5a94c" strokeWidth="1.5" strokeOpacity="0.85" />
            <circle cx="24" cy="24" r="13" stroke="#e5a94c" strokeWidth="1" strokeDasharray="3 3" strokeOpacity="0.65" />
            <path d="M24 2V46M2 24H46" stroke="#e5a94c" strokeWidth="1" strokeOpacity="0.45" />
            <polygon points="24,10 30,24 24,38 18,24" fill="#e5a94c" fillOpacity="0.2" stroke="#f5d18c" strokeWidth="1.4" />
            <circle cx="24" cy="24" r="3" fill="#f5d18c" />
          </svg>
          <span className="font-mono text-[11px] tracking-[0.28em] text-[#e5a94c] uppercase hud-text-shadow">
            Echoes of the Living Atlas
          </span>
        </div>

        <h1 className="font-display text-5xl font-bold tracking-[0.14em] text-[#f7f1e5] sm:text-6xl md:text-7xl hud-text-shadow">
          AETHERN
        </h1>

        <p className="mt-4 max-w-md text-sm leading-relaxed text-[#e6dfd1]/90 sm:text-base hud-text-shadow">
          Explore sunlit highland monoliths shaped by your on-device vector memory,
          emergent shrine quests, adaptive soundscapes, and real-world coordinates.
        </p>

        {/* Primary & Secondary CTAs */}
        <div className="pointer-events-auto mt-8 flex flex-wrap items-center gap-3.5">
          <button
            type="button"
            data-start="true"
            onClick={onStart}
            className="cursor-pointer border border-[#f5d18c] bg-[#e5a94c] px-7 py-3.5 font-display text-sm font-bold tracking-[0.2em] text-[#11151d] uppercase shadow-lg transition hover:bg-[#f1bd68] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f5d18c]"
          >
            Enter Realm
          </button>

          {!user ? (
            <button
              type="button"
              disabled={authBusy}
              onClick={onSignIn}
              className="flex cursor-pointer items-center gap-2 border border-[#f3ece0]/35 bg-[#121824]/85 px-5 py-3.5 text-xs font-semibold tracking-[0.16em] text-[#f3ece0] uppercase transition hover:border-[#e5a94c] hover:text-[#f5d18c] disabled:opacity-50"
            >
              <LogIn className="h-4 w-4 text-[#e5a94c]" />
              <span>{authBusy ? 'Signing In...' : 'Google Cloud Sync'}</span>
            </button>
          ) : (
            <span className="font-mono text-xs text-[#b9c7b7] hud-text-shadow">
              Cloud Ready · {memoryCount} Local Vectors
            </span>
          )}
        </div>

        {authError && (
          <p className="pointer-events-auto mt-3 max-w-md border border-[#e05d5d]/50 bg-[#241216]/90 px-3 py-2 text-xs text-[#f6b4b4]">
            {authError}
          </p>
        )}
      </div>

      {/* Single flat borderless control hint line */}
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 text-[11px] tracking-[0.14em] text-[#e8dfd0]/80 uppercase hud-text-shadow">
        <span>
          WASD Move · Drag Orbit · Space Jump · Shift Dash · F Resonance Strike · E Shrine · Esc Pause
        </span>
        <span className="font-mono text-[#e5a94c]/90">Press Enter to Begin</span>
      </div>
    </div>
  );
};
