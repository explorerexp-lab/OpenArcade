import React, { useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { Compass, Eye, X } from 'lucide-react';
import type { MapLandmarkNode } from '../game/geoEngine';

interface StreetViewReconModalProps {
  node: MapLandmarkNode | null;
  onClose: () => void;
}

export const StreetViewReconModal: React.FC<StreetViewReconModalProps> = ({
  node,
  onClose,
}) => {
  const streetViewLib = useMapsLibrary('streetView');
  const panoContainerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  useEffect(() => {
    if (!node || !streetViewLib || !panoContainerRef.current) return;

    let cancelled = false;
    let pano: google.maps.StreetViewPanorama | null = null;
    setStatus('loading');

    const service = new streetViewLib.StreetViewService();
    service
      .getPanorama({
        location: node.position,
        radius: 120,
      })
      .then((res) => {
        if (cancelled || !panoContainerRef.current) return;
        const panoLoc = res.data.location?.latLng;
        pano = new streetViewLib.StreetViewPanorama(panoContainerRef.current, {
          position: panoLoc || node.position,
          pov: { heading: 120, pitch: 4 },
          zoom: 1,
          addressControl: true,
          fullscreenControl: false,
          motionTracking: false,
          enableCloseButton: false,
        });
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('unavailable');
        }
      });

    return () => {
      cancelled = true;
      if (pano) {
        pano.setVisible(false);
      }
    };
  }, [node, streetViewLib]);

  if (!node) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Street View Recon: ${node.name}`}
      className="fixed inset-0 z-40 flex items-center justify-center bg-[#090d14]/82 p-4"
    >
      <div className="w-full max-w-3xl border border-[#e5a94c]/45 bg-[#101622] text-[#f2ece1] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#f2ece1]/12 px-5 py-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <Eye className="h-4 w-4 shrink-0 text-[#e5a94c]" />
            <div className="min-w-0">
              <h2 className="truncate font-display text-base font-bold tracking-wide text-[#f7e7c6]">
                Street View Recon — {node.name}
              </h2>
              <p className="truncate font-mono text-[11px] text-[#9aa5b8]">
                {node.address || `${node.position.lat.toFixed(5)}, ${node.position.lng.toFixed(5)}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close Street View Recon"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center border border-[#f2ece1]/20 text-[#d8cfc0] transition hover:border-[#e5a94c] hover:text-[#e5a94c]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="relative h-[400px] w-full bg-[#0b1018]">
          <div ref={panoContainerRef} className="h-full w-full" />
          {status === 'loading' && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#0b1018]/90 text-xs text-[#b5bece]">
              Connecting to Street View imagery...
            </div>
          )}
          {status === 'unavailable' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0b1018] p-6 text-center text-sm text-[#b5bece]">
              <Compass className="h-8 w-8 text-[#e5a94c]" />
              <p className="font-semibold text-[#f2ece1]">
                No Street View coverage at this exact coordinate
              </p>
              <p className="max-w-md text-xs text-[#95a0b3]">
                Try selecting a nearby landmark on a main city street or switch to Satellite Hybrid view on the map.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
