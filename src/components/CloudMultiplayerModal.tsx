import React, { useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Cloud,
  Download,
  Flag,
  LogIn,
  LogOut,
  ShieldCheck,
  Upload,
  Users,
  X,
} from 'lucide-react';
import type { NarrativeBeacon, RemoteWayfarer, WorldState } from '../game/types';

interface CloudMultiplayerModalProps {
  open: boolean;
  user: User | null;
  world: WorldState;
  remotePlayers: RemoteWayfarer[];
  beacons: NarrativeBeacon[];
  syncBusy: boolean;
  syncMessage: string | null;
  syncError: string | null;
  showTouchControls: boolean;
  onClose: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onUploadSave: () => void;
  onRestoreSave: () => void;
  onPlantBeacon: (message: string) => Promise<void>;
  onToggleTouchControls: () => void;
}

export const CloudMultiplayerModal: React.FC<CloudMultiplayerModalProps> = ({
  open,
  user,
  world,
  remotePlayers,
  beacons,
  syncBusy,
  syncMessage,
  syncError,
  showTouchControls,
  onClose,
  onSignIn,
  onSignOut,
  onUploadSave,
  onRestoreSave,
  onPlantBeacon,
  onToggleTouchControls,
}) => {
  const [beaconMsg, setBeaconMsg] = useState('');
  const [beaconBusy, setBeaconBusy] = useState(false);

  if (!open) return null;

  const handleBeaconSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = beaconMsg.trim();
    if (clean.length < 3) return;
    setBeaconBusy(true);
    try {
      await onPlantBeacon(clean);
      setBeaconMsg('');
    } finally {
      setBeaconBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-[#0c1018]/78 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Cloud Save and Cross-Platform Multiplayer"
    >
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col border border-[#e5a94c]/40 bg-[#121824] text-[#f3ece0] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#f3ece0]/12 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Cloud className="h-5 w-5 text-[#e5a94c]" />
            <div>
              <h2 className="font-display text-lg font-bold tracking-[0.12em] uppercase">
                Cloud Sync & Realm Multiplayer
              </h2>
              <p className="font-mono text-[11px] text-[#a79f90]">
                Local-First Execution · Firebase Auth & Firestore Synchronization
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close Cloud Sync"
            onClick={onClose}
            className="flex h-9 w-9 cursor-pointer items-center justify-center border border-[#f3ece0]/20 text-[#d8cfc0] transition hover:border-[#e5a94c] hover:text-[#e5a94c]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Authentication & Security Status */}
          <section className="border border-[#f3ece0]/14 bg-[#0f141f] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="h-5 w-5 text-[#52c78c]" />
                <div>
                  <div className="text-xs font-semibold text-[#f3ece0]">
                    {user ? user.displayName || 'Verified Wayfarer' : 'Offline Local Mode'}
                  </div>
                  <div className="font-mono text-[11px] text-[#a79f90]">
                    {user
                      ? `${user.email} · ${user.emailVerified ? 'Verified Identity' : 'Unverified'}`
                      : 'Sign in with Google to synchronize saves & join live realms'}
                  </div>
                </div>
              </div>

              {user ? (
                <button
                  type="button"
                  onClick={onSignOut}
                  className="flex cursor-pointer items-center gap-1.5 border border-[#f3ece0]/25 bg-[#182030] px-3 py-1.5 font-mono text-xs uppercase transition hover:border-[#e05d5d] hover:text-[#f5b4b4]"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Sign Out</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={syncBusy}
                  onClick={onSignIn}
                  className="flex cursor-pointer items-center gap-1.5 border border-[#f5d18c] bg-[#e5a94c] px-4 py-2 font-mono text-xs font-bold text-[#101520] uppercase transition hover:bg-[#f2be6a] disabled:opacity-50"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  <span>Sign In with Google</span>
                </button>
              )}
            </div>

            {user && (
              <div className="mt-4 flex flex-wrap gap-2.5 border-t border-[#f3ece0]/12 pt-3.5">
                <button
                  type="button"
                  disabled={syncBusy}
                  onClick={onUploadSave}
                  className="flex cursor-pointer items-center gap-1.5 border border-[#e5a94c] bg-[#e5a94c] px-3.5 py-2 font-mono text-xs font-bold text-[#101520] uppercase transition hover:bg-[#f2be6a] disabled:opacity-50"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>Sync Save & Vectors to Cloud</span>
                </button>
                <button
                  type="button"
                  disabled={syncBusy}
                  onClick={onRestoreSave}
                  className="flex cursor-pointer items-center gap-1.5 border border-[#7cd7f2]/55 bg-[#11202e] px-3.5 py-2 font-mono text-xs font-semibold text-[#9be4fa] uppercase transition hover:border-[#7cd7f2] disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Restore Cloud Save</span>
                </button>
              </div>
            )}

            {syncMessage && (
              <p className="mt-2.5 border border-[#52c78c]/45 bg-[#122620] px-3 py-2 text-xs text-[#baf0d4]">
                {syncMessage}
              </p>
            )}
            {syncError && (
              <p className="mt-2.5 border border-[#e05d5d]/45 bg-[#261317] px-3 py-2 text-xs text-[#f5b4b4]">
                {syncError}
              </p>
            )}
          </section>

          {/* Cross-Platform Multiplayer Room */}
          <section className="border border-[#f3ece0]/14 bg-[#0f141f] p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-[#7cd7f2]" />
                <h3 className="font-display text-sm font-bold tracking-wider uppercase">
                  Realm Channel: {world.realmId}
                </h3>
              </div>
              <span className="font-mono text-[11px] tabular-nums text-[#52c78c]">
                {remotePlayers.length} Remote Online
              </span>
            </div>

            {remotePlayers.length === 0 ? (
              <p className="mt-2 text-xs text-[#9d9587]">
                No other wayfarers detected in this coordinate channel right now. Invite a friend
                to attune to ({world.lat.toFixed(2)}, {world.lng.toFixed(2)}) on desktop or mobile.
              </p>
            ) : (
              <ul className="mt-2.5 space-y-1.5 font-mono text-xs">
                {remotePlayers.map((rp) => (
                  <li
                    key={rp.uid}
                    className="flex items-center justify-between border border-[#f3ece0]/10 bg-[#151c29] px-3 py-1.5"
                  >
                    <span className="text-[#f3ece0]">{rp.callsign}</span>
                    <span className="text-[#9eb3c7]">
                      {rp.faction.toUpperCase()} · {rp.shards} Shards
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {/* Shared Narrative Beacons */}
            <form onSubmit={handleBeaconSubmit} className="mt-4 space-y-2 border-t border-[#f3ece0]/12 pt-3">
              <label className="flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-[#e5a94c] uppercase">
                <Flag className="h-3 w-3" />
                <span>Plant Shared Narrative Beacon at Current Position</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  disabled={!user || beaconBusy}
                  value={beaconMsg}
                  onChange={(e) => setBeaconMsg(e.target.value)}
                  maxLength={160}
                  placeholder={
                    user
                      ? 'Leave an inscription for other wayfarers...'
                      : 'Sign in with Google to plant shared beacons'
                  }
                  className="min-w-0 flex-1 border border-[#f3ece0]/18 bg-[#151c29] px-3 py-1.5 text-xs text-[#f3ece0] placeholder:text-[#7f796f] focus:border-[#e5a94c] focus:outline-none disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!user || beaconBusy || beaconMsg.trim().length < 3}
                  className="cursor-pointer border border-[#e5a94c]/60 bg-[#1e2636] px-3.5 py-1.5 font-mono text-xs font-semibold text-[#f5d18c] uppercase transition hover:bg-[#e5a94c] hover:text-[#101520] disabled:opacity-40"
                >
                  Plant
                </button>
              </div>
            </form>

            {beacons.length > 0 && (
              <ul className="mt-3 max-h-28 space-y-1.5 overflow-y-auto text-xs">
                {beacons.slice(0, 5).map((b) => (
                  <li
                    key={b.id}
                    className="border-l-2 border-[#e5a94c]/65 bg-[#151c29] px-2.5 py-1.5"
                  >
                    <span className="font-mono text-[10px] text-[#e5a94c]">{b.callsign}: </span>
                    <span className="text-[#dfd7c8]">{b.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Cross-Platform Input Preference */}
          <section className="flex items-center justify-between border border-[#f3ece0]/14 bg-[#0f141f] px-4 py-3 text-xs">
            <div>
              <div className="font-semibold text-[#f3ece0]">On-Screen Touch Controls</div>
              <div className="text-[11px] text-[#9d9587]">
                Auto-enabled on mobile & tablet screens; toggle anytime for touch laptops.
              </div>
            </div>
            <button
              type="button"
              onClick={onToggleTouchControls}
              className={`cursor-pointer border px-3 py-1.5 font-mono text-[11px] uppercase transition ${
                showTouchControls
                  ? 'border-[#52c78c] bg-[#132922] text-[#8ef0bc]'
                  : 'border-[#f3ece0]/22 bg-[#182030] text-[#c7beae]'
              }`}
            >
              {showTouchControls ? 'Visible' : 'Hidden'}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
};
