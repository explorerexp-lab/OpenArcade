import React, { useState } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  Map as GoogleMap,
  Pin,
} from '@vis.gl/react-google-maps';
import { Compass, Globe, X } from 'lucide-react';
import { BIOME_PALETTES, deriveBiomeFromCoords } from '../game/questEngine';
import type { WorldState } from '../game/types';

interface WorldAtlasModalProps {
  open: boolean;
  world: WorldState;
  onClose: () => void;
  onAttuneCoordinates: (lat: number, lng: number) => void;
}

const PRESET_COORDS = [
  { label: 'Swiss Alps (Highland Dusk)', lat: 46.5197, lng: 6.6323 },
  { label: 'Kyoto Caldera (Pacific Jade)', lat: 35.0116, lng: 135.7681 },
  { label: 'Sahara Meridian (Amber)', lat: 23.4162, lng: 25.6628 },
  { label: 'Reykjavik Rift (Borealis)', lat: 64.1466, lng: -21.9426 },
];

export const WorldAtlasModal: React.FC<WorldAtlasModalProps> = ({
  open,
  world,
  onClose,
  onAttuneCoordinates,
}) => {
  const [selected, setSelected] = useState<{ lat: number; lng: number }>({
    lat: world.lat,
    lng: world.lng,
  });

  if (!open) return null;

  const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
  const preview = deriveBiomeFromCoords(selected.lat, selected.lng);
  const previewPalette = BIOME_PALETTES[preview.biomeKey];

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-[#0c1018]/78 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Living World Atlas Map"
    >
      <div className="w-full max-w-3xl border border-[#e5a94c]/40 bg-[#121824] text-[#f3ece0] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#f3ece0]/12 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Globe className="h-5 w-5 text-[#e5a94c]" />
            <div>
              <h2 className="font-display text-lg font-bold tracking-[0.12em] uppercase">
                Living World Atlas
              </h2>
              <p className="font-mono text-[11px] text-[#a79f90]">
                Select real-world coordinates to re-seed the 3D biome & multiplayer realm channel
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close World Atlas"
            onClick={onClose}
            className="flex h-9 w-9 cursor-pointer items-center justify-center border border-[#f3ece0]/20 text-[#d8cfc0] transition hover:border-[#e5a94c] hover:text-[#e5a94c]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* Quick Biome Coordinate Presets */}
          <div className="flex flex-wrap gap-2">
            {PRESET_COORDS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setSelected({ lat: preset.lat, lng: preset.lng })}
                className="cursor-pointer border border-[#f3ece0]/18 bg-[#182030] px-3 py-1.5 font-mono text-[11px] text-[#dfd7c8] transition hover:border-[#e5a94c] hover:text-[#f5d18c]"
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Interactive Google Maps Container with explicit height */}
          <div className="h-[340px] w-full overflow-hidden border border-[#e5a94c]/30 bg-[#0d121c]">
            {mapsApiKey ? (
              <APIProvider apiKey={mapsApiKey} language="en" region="US">
                <GoogleMap
                  mapId="DEMO_MAP_ID"
                  internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                  defaultCenter={selected}
                  center={selected}
                  defaultZoom={4}
                  gestureHandling="greedy"
                  onClick={(ev) => {
                    const latLng = ev.detail.latLng;
                    if (latLng) {
                      setSelected({ lat: latLng.lat, lng: latLng.lng });
                    }
                  }}
                >
                  <AdvancedMarker position={selected} title={preview.realmName}>
                    <Pin
                      background={previewPalette.accentHex}
                      borderColor="#101520"
                      glyphColor="#101520"
                    />
                  </AdvancedMarker>
                </GoogleMap>
              </APIProvider>
            ) : (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center text-xs text-[#c7beae]">
                <Compass className="mb-2 h-8 w-8 text-[#e5a94c]" />
                <p>
                  Google Maps API key is not present in this environment. You can still choose any
                  preset coordinate above to reshape the 3D biome locally.
                </p>
              </div>
            )}
          </div>

          {/* Preview & Attune Footer */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#f3ece0]/12 pt-3.5">
            <div className="text-xs">
              <div className="font-mono text-[10px] tracking-widest text-[#e5a94c] uppercase">
                Target Realm Channel: {preview.realmId}
              </div>
              <div className="mt-0.5 font-semibold text-[#f3ece0]">
                {preview.realmName} ({selected.lat.toFixed(2)}, {selected.lng.toFixed(2)})
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                onAttuneCoordinates(selected.lat, selected.lng);
                onClose();
              }}
              className="cursor-pointer border border-[#f5d18c] bg-[#e5a94c] px-5 py-2.5 font-display text-xs font-bold tracking-[0.18em] text-[#101520] uppercase transition hover:bg-[#f2be6a]"
            >
              Attune 3D Realm
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
