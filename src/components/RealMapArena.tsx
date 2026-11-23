import React, { useEffect, useRef } from 'react';
import {
  AdvancedMarker,
  Map as GoogleMap,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {
  CLAIM_RADIUS_METERS,
  classifyPlaceToNodeKind,
  computePathLengthMeters,
  createFallbackSignalNodes,
  haversineMeters,
  rewardForNodeKind,
  type ActiveRouteState,
  type AetherDrop,
  type GeoPlayerState,
  type LatLngLiteral,
  type MapHunter,
  type MapLandmarkNode,
} from '../game/geoEngine';
import type { NarrativeBeacon, RemoteWayfarer } from '../game/types';

export type TacticalMapStyle = 'dark' | 'hybrid' | 'terrain';

interface RealMapArenaProps {
  center: LatLngLiteral;
  panTrigger: number;
  scanTrigger: number;
  followPlayer: boolean;
  mapStyle: TacticalMapStyle;
  isPlaying: boolean;
  player: GeoPlayerState;
  nodes: MapLandmarkNode[];
  hunters: MapHunter[];
  drops: AetherDrop[];
  selectedNodeId: string | null;
  routeTarget: { position: LatLngLiteral; nodeId: string | null; label: string; requestId: number } | null;
  remotePlayers: RemoteWayfarer[];
  beacons: NarrativeBeacon[];
  onNodesScanned: (nodes: MapLandmarkNode[], realPlacesFound: number) => void;
  onRouteComputed: (route: ActiveRouteState) => void;
  onSelectNode: (node: MapLandmarkNode) => void;
  onMapClick: (pos: LatLngLiteral) => void;
}

function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|RESOURCE_EXHAUSTED|OVER_QUERY_LIMIT|QuotaExceeded|REQUEST_DENIED/i.test(msg);
}

/**
 * Inner map controller running inside <GoogleMap> context:
 * - Scans real nearby places via Places API (New) `Place.searchNearby`
 * - Computes real walking street routes via Routes API `Route.computeRoutes` + `createPolylines()`
 * - Manages live imperative google.maps.Circle overlays (Claim radius, EMP Pulse shockwave, Warden telegraph)
 */
const MapControllers: React.FC<{
  center: LatLngLiteral;
  panTrigger: number;
  scanTrigger: number;
  followPlayer: boolean;
  isPlaying: boolean;
  player: GeoPlayerState;
  hunters: MapHunter[];
  routeTarget: { position: LatLngLiteral; nodeId: string | null; label: string; requestId: number } | null;
  onNodesScanned: (nodes: MapLandmarkNode[], realPlacesFound: number) => void;
  onRouteComputed: (route: ActiveRouteState) => void;
}> = ({
  center,
  panTrigger,
  scanTrigger,
  followPlayer,
  isPlaying,
  player,
  hunters,
  routeTarget,
  onNodesScanned,
  onRouteComputed,
}) => {
  const map = useMap();
  const placesLib = useMapsLibrary('places');
  const routesLib = useMapsLibrary('routes');
  const mapsLib = useMapsLibrary('maps');

  const routePolylinesRef = useRef<google.maps.Polyline[]>([]);
  const claimCircleRef = useRef<google.maps.Circle | null>(null);
  const pulseCircleRef = useRef<google.maps.Circle | null>(null);
  const wardenCirclesRef = useRef<Record<string, google.maps.Circle>>({});
  const lastScanKeyRef = useRef<string>('');
  const playerPosRef = useRef<LatLngLiteral>(player.position);
  playerPosRef.current = player.position;

  // Pan map smoothly when sector changes or recenter is requested
  useEffect(() => {
    if (!map) return;
    map.panTo(center);
    if (map.getZoom() !== undefined && (map.getZoom() ?? 15) < 14) {
      map.setZoom(15);
    }
  }, [map, center.lat, center.lng, panTrigger]);

  // Soft camera follow during gameplay when runner nears edge of view
  useEffect(() => {
    if (!map || !isPlaying || !followPlayer) return;
    const bounds = map.getBounds();
    if (!bounds) return;
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    const latSpan = Math.abs(ne.lat() - sw.lat());
    const lngSpan = Math.abs(ne.lng() - sw.lng());
    const mapCenter = map.getCenter();
    if (!mapCenter) return;
    const dLat = Math.abs(player.position.lat - mapCenter.lat());
    const dLng = Math.abs(player.position.lng - mapCenter.lng());
    if (dLat > latSpan * 0.24 || dLng > lngSpan * 0.24) {
      map.panTo(player.position);
    }
  }, [map, isPlaying, followPlayer, player.position.lat, player.position.lng]);

  // Real Google Maps Places API (New): Place.searchNearby around sector center
  useEffect(() => {
    if (!placesLib) return;
    const scanKey = `${center.lat.toFixed(4)},${center.lng.toFixed(4)}#${scanTrigger}`;
    if (lastScanKeyRef.current === scanKey) return;
    lastScanKeyRef.current = scanKey;

    let cancelled = false;

    const runScan = async () => {
      try {
        const request: google.maps.places.SearchNearbyRequest = {
          fields: ['id', 'displayName', 'location', 'primaryType', 'types', 'formattedAddress'],
          locationRestriction: {
            center,
            radius: 750,
          },
          includedPrimaryTypes: [
            'park',
            'museum',
            'library',
            'tourist_attraction',
            'historical_landmark',
            'art_gallery',
            'cafe',
            'bakery',
            'book_store',
            'train_station',
            'subway_station',
          ],
          maxResultCount: 12,
        };

        const { places } = await placesLib.Place.searchNearby(request);
        if (cancelled) return;

        const mapped: MapLandmarkNode[] = [];
        for (const p of places ?? []) {
          if (!p.location || !p.displayName) continue;
          const lat = typeof p.location.lat === 'function' ? p.location.lat() : Number(p.location.lat);
          const lng = typeof p.location.lng === 'function' ? p.location.lng() : Number(p.location.lng);
          const pos = { lat, lng };
          // Keep nodes cleanly spread at least 110m apart so pins and labels stay crisp on downtown grids
          if (mapped.some((existing) => haversineMeters(existing.position, pos) < 110)) {
            continue;
          }
          const kind = classifyPlaceToNodeKind(p.primaryType, p.types);
          mapped.push({
            id: `place-${p.id || mapped.length}`,
            placeId: p.id || undefined,
            name: String(p.displayName),
            address: p.formattedAddress || undefined,
            primaryType: p.primaryType || undefined,
            kind,
            position: pos,
            captured: false,
            isRealPlace: true,
            rewardShards: rewardForNodeKind(kind),
          });
          if (mapped.length >= 8) break;
        }

        if (mapped.length >= 3) {
          onNodesScanned(mapped, mapped.length);
        } else {
          // Zero hallucinated place data: supplement strictly with abstract tactical signal caches
          const fallback = createFallbackSignalNodes(center);
          const combined = [...mapped, ...fallback.slice(0, Math.max(0, 6 - mapped.length))];
          onNodesScanned(combined, mapped.length);
        }
      } catch (err) {
        if (cancelled) return;
        if (isQuotaError(err)) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        onNodesScanned(createFallbackSignalNodes(center), 0);
      }
    };

    void runScan();
    return () => {
      cancelled = true;
    };
  }, [placesLib, center.lat, center.lng, scanTrigger, onNodesScanned]);

  // Real Street-Level Routing via Modern Routes API (`Route.computeRoutes`)
  useEffect(() => {
    // Clear previous polylines whenever route target changes or is cleared
    routePolylinesRef.current.forEach((p) => p.setMap(null));
    routePolylinesRef.current = [];

    if (!routeTarget || !map) return;

    let cancelled = false;
    const origin = { ...playerPosRef.current };
    const destination = routeTarget.position;

    const fallbackDirect = () => {
      if (cancelled) return;
      const dist = haversineMeters(origin, destination);
      if (mapsLib) {
        const line = new mapsLib.Polyline({
          path: [origin, destination],
          strokeColor: '#e5a94c',
          strokeOpacity: 0.9,
          strokeWeight: 4,
          geodesic: true,
          map,
        });
        routePolylinesRef.current = [line];
      }
      onRouteComputed({
        targetNodeId: routeTarget.nodeId,
        targetName: routeTarget.label,
        path: [origin, destination],
        totalMeters: dist,
        traveledMeters: 0,
        estimatedWalkMins: Math.max(1, Math.round(dist / 80)),
        isRealStreetRoute: false,
      });
    };

    if (!routesLib || !('Route' in routesLib)) {
      fallbackDirect();
      return () => {
        cancelled = true;
        routePolylinesRef.current.forEach((p) => p.setMap(null));
        routePolylinesRef.current = [];
      };
    }

    const request = {
      origin,
      destination,
      travelMode: 'WALKING',
      fields: ['path', 'distanceMeters', 'durationMillis', 'viewport'],
    };

    // Modern SDK wrapper bypassing CORS (per Google Maps Platform React skill)
    const RouteClass = (routesLib as unknown as {
      Route: {
        computeRoutes: (req: typeof request) => Promise<{
          routes?: Array<{
            path?: google.maps.LatLng[];
            distanceMeters?: number;
            durationMillis?: number;
            createPolylines?: () => google.maps.Polyline[];
          }>;
        }>;
      };
    }).Route;

    RouteClass.computeRoutes(request)
      .then(({ routes }) => {
        if (cancelled) return;
        const primary = routes?.[0];
        if (!primary) {
          fallbackDirect();
          return;
        }

        const rawPath: LatLngLiteral[] = (primary.path ?? []).map((pt) => ({
          lat: typeof pt.lat === 'function' ? pt.lat() : Number(pt.lat),
          lng: typeof pt.lng === 'function' ? pt.lng() : Number(pt.lng),
        }));

        const cleanPath = rawPath.length >= 2 ? rawPath : [origin, destination];

        if (typeof primary.createPolylines === 'function') {
          const lines = primary.createPolylines();
          lines.forEach((poly) => {
            poly.setOptions({
              strokeColor: '#f5b951',
              strokeOpacity: 0.95,
              strokeWeight: 5,
            });
            poly.setMap(map);
          });
          routePolylinesRef.current = lines;
        } else if (mapsLib) {
          const line = new mapsLib.Polyline({
            path: cleanPath,
            strokeColor: '#f5b951',
            strokeOpacity: 0.95,
            strokeWeight: 5,
            map,
          });
          routePolylinesRef.current = [line];
        }

        const totalMeters = primary.distanceMeters ?? computePathLengthMeters(cleanPath);
        const estimatedWalkMins = Math.max(
          1,
          Math.round((primary.durationMillis ?? totalMeters * 750) / 60000)
        );

        onRouteComputed({
          targetNodeId: routeTarget.nodeId,
          targetName: routeTarget.label,
          path: cleanPath,
          totalMeters,
          traveledMeters: 0,
          estimatedWalkMins,
          isRealStreetRoute: rawPath.length >= 2,
        });
      })
      .catch((err) => {
        if (isQuotaError(err)) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        fallbackDirect();
      });

    return () => {
      cancelled = true;
      routePolylinesRef.current.forEach((p) => p.setMap(null));
      routePolylinesRef.current = [];
    };
  }, [routesLib, mapsLib, map, routeTarget, onRouteComputed]);

  // Imperative Tactical Circles (Claim Range + EMP Pulse Shockwave + Warden Telegraph Rings)
  useEffect(() => {
    if (!map || !mapsLib) return;

    if (!claimCircleRef.current) {
      claimCircleRef.current = new mapsLib.Circle({
        map,
        center: player.position,
        radius: CLAIM_RADIUS_METERS,
        strokeColor: '#e5a94c',
        strokeOpacity: 0.65,
        strokeWeight: 1.75,
        fillColor: '#e5a94c',
        fillOpacity: 0.08,
        clickable: false,
      });
    } else {
      claimCircleRef.current.setCenter(player.position);
      claimCircleRef.current.setMap(isPlaying ? map : null);
    }

    // Expanding EMP Shockwave Ring
    if (player.pulseActiveTimer > 0 && isPlaying) {
      const progress = 1 - player.pulseActiveTimer / 0.75;
      const radius = 30 + progress * (player.pulseRadiusMeters - 30);
      if (!pulseCircleRef.current) {
        pulseCircleRef.current = new mapsLib.Circle({
          map,
          center: player.position,
          radius,
          strokeColor: '#38bdf8',
          strokeOpacity: 0.9 * (1 - progress * 0.7),
          strokeWeight: 3,
          fillColor: '#38bdf8',
          fillOpacity: 0.18 * (1 - progress),
          clickable: false,
        });
      } else {
        pulseCircleRef.current.setCenter(player.position);
        pulseCircleRef.current.setRadius(radius);
        pulseCircleRef.current.setOptions({
          strokeOpacity: 0.9 * (1 - progress * 0.7),
          fillOpacity: 0.18 * (1 - progress),
          map,
        });
      }
    } else if (pulseCircleRef.current) {
      pulseCircleRef.current.setMap(null);
    }

    // Warden Telegraph Hazard Rings
    const activeWardenIds = new Set<string>();
    for (const h of hunters) {
      if (!h.defeated && h.archetype === 'warden' && h.telegraphTimer > 0 && isPlaying) {
        activeWardenIds.add(h.id);
        const ratio = Math.min(1, h.telegraphTimer / h.telegraphMax);
        const radius = 35 + ratio * 90;
        let circle = wardenCirclesRef.current[h.id];
        if (!circle) {
          circle = new mapsLib.Circle({
            map,
            center: h.position,
            radius,
            strokeColor: '#ef4444',
            strokeOpacity: 0.95,
            strokeWeight: 2.5,
            fillColor: '#ef4444',
            fillOpacity: 0.12 + ratio * 0.24,
            clickable: false,
          });
          wardenCirclesRef.current[h.id] = circle;
        } else {
          circle.setCenter(h.position);
          circle.setRadius(radius);
          circle.setOptions({
            fillOpacity: 0.12 + ratio * 0.24,
            map,
          });
        }
      }
    }

    for (const id of Object.keys(wardenCirclesRef.current)) {
      if (!activeWardenIds.has(id)) {
        wardenCirclesRef.current[id].setMap(null);
        delete wardenCirclesRef.current[id];
      }
    }
  }, [
    map,
    mapsLib,
    isPlaying,
    player.position,
    player.pulseActiveTimer,
    player.pulseRadiusMeters,
    hunters,
  ]);

  // Cleanup imperative circles on unmount
  useEffect(() => {
    return () => {
      claimCircleRef.current?.setMap(null);
      pulseCircleRef.current?.setMap(null);
      Object.values(wardenCirclesRef.current).forEach((c) => c.setMap(null));
      wardenCirclesRef.current = {};
    };
  }, []);

  return null;
};

function nodeAccent(kind: MapLandmarkNode['kind'], captured: boolean): {
  bg: string;
  border: string;
  label: string;
} {
  if (captured) {
    return { bg: '#d49a38', border: '#fff2cc', label: 'Claimed' };
  }
  switch (kind) {
    case 'sanctuary':
      return { bg: '#182235', border: '#e5a94c', label: 'Sanctuary' };
    case 'supply':
      return { bg: '#102925', border: '#34d399', label: 'Supply' };
    case 'transit':
      return { bg: '#112538', border: '#38bdf8', label: 'Transit' };
    default:
      return { bg: '#1a2232', border: '#f5b951', label: 'Signal' };
  }
}

export const RealMapArena: React.FC<RealMapArenaProps> = ({
  center,
  panTrigger,
  scanTrigger,
  followPlayer,
  mapStyle,
  isPlaying,
  player,
  nodes,
  hunters,
  drops,
  selectedNodeId,
  routeTarget,
  remotePlayers,
  beacons,
  onNodesScanned,
  onRouteComputed,
  onSelectNode,
  onMapClick,
}) => {
  const mapTypeId =
    mapStyle === 'hybrid' ? 'hybrid' : mapStyle === 'terrain' ? 'terrain' : 'roadmap';
  const colorScheme = mapStyle === 'dark' ? 'DARK' : 'LIGHT';

  return (
    <div
      data-testid="real-map-container"
      className="fixed inset-0 h-full w-full bg-[#0e131d]"
    >
      <GoogleMap
        mapId="DEMO_MAP_ID"
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        defaultCenter={center}
        defaultZoom={16}
        mapTypeId={mapTypeId}
        colorScheme={colorScheme}
        gestureHandling="greedy"
        disableDefaultUI
        clickableIcons={false}
        onClick={(ev) => {
          const latLng = ev.detail.latLng;
          if (latLng && isPlaying) {
            onMapClick({ lat: latLng.lat, lng: latLng.lng });
          }
        }}
      >
        <MapControllers
          center={center}
          panTrigger={panTrigger}
          scanTrigger={scanTrigger}
          followPlayer={followPlayer}
          isPlaying={isPlaying}
          player={player}
          hunters={hunters}
          routeTarget={routeTarget}
          onNodesScanned={onNodesScanned}
          onRouteComputed={onRouteComputed}
        />

        {/* Roadside Aether Shard Drops */}
        {isPlaying &&
          drops
            .filter((d) => !d.collected)
            .map((drop) => (
              <AdvancedMarker
                key={drop.id}
                position={drop.position}
                title={`Aether Shard Cache (+${drop.shards})`}
                zIndex={10}
              >
                <div className="flex h-4 w-4 rotate-45 items-center justify-center border border-[#fff4cf] bg-[#e5a94c] shadow-md">
                  <div className="h-1.5 w-1.5 bg-[#101520]" />
                </div>
              </AdvancedMarker>
            ))}

        {/* Real-World Landmark / Place Nodes */}
        {nodes.map((node) => {
          const style = nodeAccent(node.kind, node.captured);
          const selected = node.id === selectedNodeId;
          const dist = Math.round(haversineMeters(player.position, node.position));
          const inRange = dist <= CLAIM_RADIUS_METERS;
          const showLabelAlways = selected || inRange || node.kind === 'sanctuary';

          return (
            <AdvancedMarker
              key={node.id}
              position={node.position}
              title={node.name}
              zIndex={selected ? 40 : inRange ? 32 : 25}
              onClick={() => onSelectNode(node)}
            >
              <button
                type="button"
                aria-label={`${node.name} (${style.label}, ${dist}m away)`}
                className="group relative flex cursor-pointer flex-col items-center focus:outline-none"
              >
                {/* Floating Place Name Plate: always visible on selected/nearby/sanctuary, reveal on hover for supply/transit */}
                <div
                  className={`mb-1 max-w-[165px] truncate border px-2 py-0.5 text-[11px] font-semibold shadow-lg transition ${
                    selected || inRange
                      ? 'border-[#e5a94c] bg-[#0d131e] text-[#f8e7c2] opacity-100'
                      : showLabelAlways
                        ? 'border-[#f2ece1]/24 bg-[#0d131e]/92 text-[#e4e9f2] opacity-90 group-hover:opacity-100'
                        : 'border-[#f2ece1]/20 bg-[#0d131e]/92 text-[#dfe5f0] opacity-0 group-hover:opacity-100'
                  }`}
                >
                  {node.name}
                </div>

                {/* Custom SVG Tactical Node Pin */}
                <div
                  className="flex h-9 w-9 items-center justify-center border-2 shadow-lg transition-transform group-hover:scale-110"
                  style={{
                    backgroundColor: style.bg,
                    borderColor: selected ? '#ffffff' : style.border,
                    transform: selected ? 'scale(1.15)' : undefined,
                  }}
                >
                  {node.captured ? (
                    <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#101520]" fill="none" stroke="currentColor" strokeWidth="2.8">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  ) : node.kind === 'supply' ? (
                    <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#34d399]" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <path d="M12 4v16M4 12h16" />
                    </svg>
                  ) : node.kind === 'transit' ? (
                    <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#38bdf8]" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <circle cx="12" cy="12" r="7" />
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#e5a94c]" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <polygon points="12,3 20,12 12,21 4,12" />
                      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
                    </svg>
                  )}
                </div>
              </button>
            </AdvancedMarker>
          );
        })}

        {/* Patrolling Shadow Hunters */}
        {isPlaying &&
          hunters
            .filter((h) => !h.defeated)
            .map((hunter) => {
              const stunned = hunter.stunTimer > 0;
              const charging = hunter.telegraphTimer > 0;
              const accent = stunned
                ? '#38bdf8'
                : hunter.archetype === 'warden'
                  ? '#f97316'
                  : hunter.archetype === 'interceptor'
                    ? '#c084fc'
                    : '#ef4444';

              return (
                <AdvancedMarker
                  key={hunter.id}
                  position={hunter.position}
                  title={`${hunter.name} (${hunter.hp}/${hunter.maxHp})`}
                  zIndex={35}
                >
                  <div className="flex flex-col items-center">
                    <div
                      className="flex h-8 w-8 items-center justify-center border-2 shadow-xl transition-transform"
                      style={{
                        backgroundColor: stunned ? '#0f2738' : '#260d12',
                        borderColor: accent,
                        transform: `rotate(${Math.round(hunter.heading)}deg) scale(${charging ? 1.2 : 1})`,
                      }}
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill={accent}>
                        {hunter.archetype === 'warden' ? (
                          <polygon points="12,2 21,7 21,17 12,22 3,17 3,7" />
                        ) : (
                          <polygon points="12,2 20,20 12,15 4,20" />
                        )}
                      </svg>
                    </div>
                    <span
                      className="mt-0.5 bg-[#0c1018]/90 px-1.5 py-0.2 font-mono text-[10px] font-semibold"
                      style={{ color: accent }}
                    >
                      {stunned
                        ? `STUN ${hunter.stunTimer.toFixed(0)}s`
                        : charging
                          ? 'BLAST!'
                          : hunter.archetype.toUpperCase()}
                    </span>
                  </div>
                </AdvancedMarker>
              );
            })}

        {/* Live Firebase Multiplayer Beacons & Remote Wayfarers */}
        {beacons.map((b) => (
          <AdvancedMarker
            key={b.id}
            position={{ lat: b.x, lng: b.z }}
            title={`${b.callsign}: ${b.message}`}
            zIndex={22}
          >
            <div className="border border-sky-300/70 bg-[#0d1726]/95 px-2 py-0.5 text-[10px] text-sky-200 shadow-lg">
              {b.callsign}: {b.message.slice(0, 28)}
            </div>
          </AdvancedMarker>
        ))}

        {remotePlayers.map((rp) => (
          <AdvancedMarker
            key={rp.uid}
            position={{ lat: rp.x, lng: rp.z }}
            title={`Wayfarer ${rp.callsign}`}
            zIndex={28}
          >
            <div className="flex flex-col items-center">
              <div className="h-3.5 w-3.5 border-2 border-white bg-sky-400 shadow-md" />
              <span className="mt-0.5 bg-[#0c1018]/90 px-1 text-[10px] text-sky-200">
                {rp.callsign}
              </span>
            </div>
          </AdvancedMarker>
        ))}

        {/* Player Runner Unit */}
        <AdvancedMarker position={player.position} title="Your Runner" zIndex={50}>
          <div className="relative flex items-center justify-center">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#fff7dc] bg-[#e5a94c] shadow-[0_0_20px_rgba(229,169,76,0.65)]"
              style={{
                transform: `rotate(${Math.round(player.heading)}deg)`,
              }}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-[#101520]" fill="currentColor">
                <polygon points="12,3 20,19 12,15 4,19" />
              </svg>
            </div>
          </div>
        </AdvancedMarker>
      </GoogleMap>
    </div>
  );
};
