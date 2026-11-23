export interface LatLngLiteral {
  lat: number;
  lng: number;
}

export type MapNodeKind = 'sanctuary' | 'supply' | 'transit' | 'signal';

export interface MapLandmarkNode {
  id: string;
  placeId?: string;
  name: string;
  address?: string;
  primaryType?: string;
  kind: MapNodeKind;
  position: LatLngLiteral;
  captured: boolean;
  isRealPlace: boolean;
  rewardShards: number;
}

export type HunterArchetype = 'stalker' | 'interceptor' | 'warden';

export interface MapHunter {
  id: string;
  archetype: HunterArchetype;
  name: string;
  position: LatLngLiteral;
  home: LatLngLiteral;
  heading: number;
  hp: number;
  maxHp: number;
  speedMps: number;
  stunTimer: number;
  telegraphTimer: number; // > 0 means charging shockwave (warden)
  telegraphMax: number;
  attackCooldown: number;
  orbitAngle: number;
  defeated: boolean;
}

export interface AetherDrop {
  id: string;
  position: LatLngLiteral;
  shards: number;
  collected: boolean;
}

export interface ActiveRouteState {
  targetNodeId: string | null;
  targetName: string;
  path: LatLngLiteral[];
  totalMeters: number;
  traveledMeters: number;
  estimatedWalkMins: number;
  isRealStreetRoute: boolean;
}

export interface GeoPlayerState {
  position: LatLngLiteral;
  heading: number;
  vxMeters: number;
  vzMeters: number;
  integrity: number;
  maxIntegrity: number;
  energy: number;
  maxEnergy: number;
  shards: number;
  score: number;
  level: number;
  distanceTraveledMeters: number;
  huntersNeutralized: number;
  pulseCooldown: number;
  pulseMaxCooldown: number;
  pulseActiveTimer: number; // Visual expanding ring timer
  pulseRadiusMeters: number;
  overdriveActive: boolean;
  invulnTimer: number;
}

export interface GeoInputState {
  moveNorth: number; // -1..1
  moveEast: number; // -1..1
  sprint: boolean;
  triggerPulse: boolean;
}

export interface GeoSimEvent {
  type:
    | 'pulse_fired'
    | 'hunter_stunned'
    | 'hunter_neutralized'
    | 'player_hit'
    | 'drop_collected'
    | 'route_arrived'
    | 'warden_blast';
  position: LatLngLiteral;
  label?: string;
  weight?: number;
}

export interface GeoSectorState {
  sectorId: string;
  sectorName: string;
  center: LatLngLiteral;
  player: GeoPlayerState;
  nodes: MapLandmarkNode[];
  hunters: MapHunter[];
  drops: AetherDrop[];
  route: ActiveRouteState | null;
  targetCaptures: number;
  capturedCount: number;
  threatLevel: number; // 0..1
  elapsedSeconds: number;
}

const EARTH_RADIUS_M = 6371000;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export const BASE_RUNNER_SPEED_MPS = 44; // Tactical stride scaled for real city blocks
export const OVERDRIVE_SPEED_MPS = 98;
export const CLAIM_RADIUS_METERS = 95;
export const PULSE_RADIUS_METERS = 220;
export const PULSE_ENERGY_COST = 24;
export const PULSE_COOLDOWN_SEC = 7.5;
export const DROP_COLLECT_RADIUS_METERS = 62;

/**
 * Exact great-circle distance in meters between two WGS84 coordinates.
 */
export function haversineMeters(a: LatLngLiteral, b: LatLngLiteral): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Compass bearing in degrees [0, 360) from coordinate a to b.
 */
export function bearingDegrees(a: LatLngLiteral, b: LatLngLiteral): number {
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * RAD_TO_DEG + 360) % 360;
}

/**
 * Displaces a coordinate by distanceMeters along bearingDeg (0 = North, 90 = East).
 */
export function offsetLatLng(
  origin: LatLngLiteral,
  distanceMeters: number,
  bearingDeg: number
): LatLngLiteral {
  if (distanceMeters === 0) return { ...origin };
  const rad = bearingDeg * DEG_TO_RAD;
  const northMeters = Math.cos(rad) * distanceMeters;
  const eastMeters = Math.sin(rad) * distanceMeters;
  const dLat = (northMeters / EARTH_RADIUS_M) * RAD_TO_DEG;
  const cosLat = Math.max(0.08, Math.cos(origin.lat * DEG_TO_RAD));
  const dLng = (eastMeters / (EARTH_RADIUS_M * cosLat)) * RAD_TO_DEG;
  return {
    lat: Math.max(-85, Math.min(85, origin.lat + dLat)),
    lng: ((origin.lng + dLng + 540) % 360) - 180,
  };
}

/**
 * Total polyline length in meters.
 */
export function computePathLengthMeters(path: LatLngLiteral[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += haversineMeters(path[i - 1], path[i]);
  }
  return total;
}

/**
 * Interpolates a coordinate along a real Google Maps road polyline given distanceTraveledMeters.
 */
export function interpolateAlongPath(
  path: LatLngLiteral[],
  distanceTraveledMeters: number
): {
  position: LatLngLiteral;
  heading: number;
  remainingMeters: number;
  arrived: boolean;
} {
  if (path.length === 0) {
    return {
      position: { lat: 0, lng: 0 },
      heading: 0,
      remainingMeters: 0,
      arrived: true,
    };
  }
  if (path.length === 1) {
    return {
      position: { ...path[0] },
      heading: 0,
      remainingMeters: 0,
      arrived: true,
    };
  }

  const total = computePathLengthMeters(path);
  if (distanceTraveledMeters >= total) {
    const last = path[path.length - 1];
    const prev = path[path.length - 2];
    return {
      position: { ...last },
      heading: bearingDegrees(prev, last),
      remainingMeters: 0,
      arrived: true,
    };
  }

  let walked = 0;
  const targetDist = Math.max(0, distanceTraveledMeters);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const segLen = haversineMeters(a, b);
    if (walked + segLen >= targetDist && segLen > 0.001) {
      const t = (targetDist - walked) / segLen;
      return {
        position: {
          lat: a.lat + (b.lat - a.lat) * t,
          lng: a.lng + (b.lng - a.lng) * t,
        },
        heading: bearingDegrees(a, b),
        remainingMeters: Math.max(0, total - targetDist),
        arrived: false,
      };
    }
    walked += segLen;
  }

  const end = path[path.length - 1];
  return {
    position: { ...end },
    heading: bearingDegrees(path[path.length - 2], end),
    remainingMeters: 0,
    arrived: true,
  };
}

const SANCTUARY_TYPES = new Set([
  'park',
  'museum',
  'library',
  'tourist_attraction',
  'historical_landmark',
  'monument',
  'art_gallery',
  'cultural_landmark',
  'plaza',
  'botanical_garden',
  'place_of_worship',
  'university',
]);

const TRANSIT_TYPES = new Set([
  'train_station',
  'subway_station',
  'transit_station',
  'light_rail_station',
  'bus_station',
  'ferry_terminal',
  'airport',
]);

const SUPPLY_TYPES = new Set([
  'cafe',
  'coffee_shop',
  'bakery',
  'book_store',
  'restaurant',
  'market',
  'supermarket',
  'pharmacy',
]);

/**
 * Classifies a real Google Maps place's primary/secondary types into tactical node classes.
 */
export function classifyPlaceToNodeKind(
  primaryType?: string | null,
  types?: string[] | null
): MapNodeKind {
  const all = [primaryType ?? '', ...(types ?? [])].map((t) => t.toLowerCase());
  for (const t of all) {
    if (SANCTUARY_TYPES.has(t)) return 'sanctuary';
  }
  for (const t of all) {
    if (TRANSIT_TYPES.has(t)) return 'transit';
  }
  for (const t of all) {
    if (SUPPLY_TYPES.has(t)) return 'supply';
  }
  return 'sanctuary';
}

export function rewardForNodeKind(kind: MapNodeKind): number {
  switch (kind) {
    case 'sanctuary':
      return 40;
    case 'transit':
      return 30;
    case 'supply':
      return 25;
    default:
      return 25;
  }
}

/**
 * Strictly abstract tactical signal nodes used ONLY if Places API returns 0 results
 * (e.g., ocean coordinates or quota exhaustion). Never hallucinates real business names.
 */
export function createFallbackSignalNodes(center: LatLngLiteral): MapLandmarkNode[] {
  const specs: Array<{ id: string; name: string; kind: MapNodeKind; dist: number; deg: number }> = [
    { id: 'sig-alpha', name: 'Signal Relay Alpha', kind: 'sanctuary', dist: 210, deg: 28 },
    { id: 'sig-beta', name: 'Supply Drop Beta', kind: 'supply', dist: 265, deg: 112 },
    { id: 'sig-gamma', name: 'Transit Beacon Gamma', kind: 'transit', dist: 330, deg: 196 },
    { id: 'sig-delta', name: 'Meridian Vault Delta', kind: 'sanctuary', dist: 390, deg: 268 },
    { id: 'sig-epsilon', name: 'Echo Relay Epsilon', kind: 'supply', dist: 445, deg: 326 },
    { id: 'sig-zeta', name: 'Citadel Spire Zeta', kind: 'sanctuary', dist: 510, deg: 64 },
  ];

  return specs.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    position: offsetLatLng(center, s.dist, s.deg),
    captured: false,
    isRealPlace: false,
    rewardShards: rewardForNodeKind(s.kind),
  }));
}

/**
 * Spawns roadside Aether Shard drops scattered cleanly between center and sector landmarks.
 */
export function spawnSectorDrops(
  center: LatLngLiteral,
  nodes: MapLandmarkNode[]
): AetherDrop[] {
  const drops: AetherDrop[] = [];
  const count = Math.min(8, Math.max(5, nodes.length));
  for (let i = 0; i < count; i++) {
    const node = nodes[i % nodes.length];
    const pos = node
      ? {
          lat: center.lat + (node.position.lat - center.lat) * (0.45 + (i % 3) * 0.14),
          lng: center.lng + (node.position.lng - center.lng) * (0.45 + (i % 3) * 0.14),
        }
      : offsetLatLng(center, 150 + i * 45, i * 52);

    drops.push({
      id: `drop-${i}-${Math.round(pos.lat * 1e4)}`,
      position: pos,
      shards: 10 + (i % 3) * 5,
      collected: false,
    });
  }
  return drops;
}

/**
 * Spawns 3 distinct Hunter archetypes at fair opening distances (>= 290m from player spawn).
 */
export function spawnSectorHunters(
  center: LatLngLiteral,
  nodes: MapLandmarkNode[],
  waveLevel = 1
): MapHunter[] {
  const safeOffset = (deg: number, dist: number) => offsetLatLng(center, Math.max(360, dist), deg);

  const farSanctuary =
    nodes.find(
      (n) => !n.captured && n.kind === 'sanctuary' && haversineMeters(center, n.position) >= 350
    ) ?? null;

  const wardenHome = farSanctuary ? farSanctuary.position : safeOffset(40, 420);
  const stalkerHome = safeOffset(165, 385);
  const interceptorHome = safeOffset(285, 445);

  const speedBonus = Math.min(10, (waveLevel - 1) * 3.5);

  const hunters: MapHunter[] = [
    {
      id: `hunter-stalker-${waveLevel}`,
      archetype: 'stalker',
      name: 'Shadow Stalker',
      position: { ...stalkerHome },
      home: { ...stalkerHome },
      heading: 0,
      hp: 2,
      maxHp: 2,
      speedMps: 27 + speedBonus,
      stunTimer: 0,
      telegraphTimer: 0,
      telegraphMax: 1.2,
      attackCooldown: 0,
      orbitAngle: 0,
      defeated: false,
    },
    {
      id: `hunter-interceptor-${waveLevel}`,
      archetype: 'interceptor',
      name: 'Grid Interceptor',
      position: { ...interceptorHome },
      home: { ...interceptorHome },
      heading: 90,
      hp: 2,
      maxHp: 2,
      speedMps: 33 + speedBonus,
      stunTimer: 0,
      telegraphTimer: 0,
      telegraphMax: 1.0,
      attackCooldown: 0,
      orbitAngle: Math.PI / 2,
      defeated: false,
    },
    {
      id: `hunter-warden-${waveLevel}`,
      archetype: 'warden',
      name: 'Rift Warden',
      position: { ...wardenHome },
      home: { ...wardenHome },
      heading: 180,
      hp: 3,
      maxHp: 3,
      speedMps: 19 + speedBonus * 0.5,
      stunTimer: 0,
      telegraphTimer: 0,
      telegraphMax: 1.5,
      attackCooldown: 1.0,
      orbitAngle: Math.PI,
      defeated: false,
    },
  ];

  return hunters;
}

export function createGeoSectorState(params: {
  sectorId: string;
  sectorName: string;
  center: LatLngLiteral;
  nodes?: MapLandmarkNode[];
  carryShards?: number;
  carryScore?: number;
  carryLevel?: number;
}): GeoSectorState {
  const initialNodes =
    params.nodes && params.nodes.length > 0
      ? params.nodes
      : createFallbackSignalNodes(params.center);

  return {
    sectorId: params.sectorId,
    sectorName: params.sectorName,
    center: { ...params.center },
    player: {
      position: { ...params.center },
      heading: 0,
      vxMeters: 0,
      vzMeters: 0,
      integrity: 100,
      maxIntegrity: 100,
      energy: 100,
      maxEnergy: 100,
      shards: params.carryShards ?? 20,
      score: params.carryScore ?? 0,
      level: params.carryLevel ?? 1,
      distanceTraveledMeters: 0,
      huntersNeutralized: 0,
      pulseCooldown: 0,
      pulseMaxCooldown: PULSE_COOLDOWN_SEC,
      pulseActiveTimer: 0,
      pulseRadiusMeters: PULSE_RADIUS_METERS,
      overdriveActive: false,
      invulnTimer: 0,
    },
    nodes: initialNodes,
    hunters: spawnSectorHunters(params.center, initialNodes, params.carryLevel ?? 1),
    drops: spawnSectorDrops(params.center, initialNodes),
    route: null,
    targetCaptures: Math.min(5, Math.max(3, initialNodes.length)),
    capturedCount: 0,
    threatLevel: 0,
    elapsedSeconds: 0,
  };
}

/**
 * Pure simulation tick (clamped dt <= 0.05s) updating player movement along real street routes
 * or manual WASD vector, EMP shockwaves, Aether drop collection, and 3 distinct Hunter AI policies.
 */
export function stepGeoSimulation(
  state: GeoSectorState,
  input: GeoInputState,
  rawDt: number
): { events: GeoSimEvent[]; victory: boolean; defeat: boolean } {
  const dt = Math.max(0, Math.min(rawDt, 0.05));
  const events: GeoSimEvent[] = [];
  if (dt === 0) {
    return {
      events,
      victory: state.capturedCount >= state.targetCaptures,
      defeat: state.player.integrity <= 0,
    };
  }

  state.elapsedSeconds += dt;
  const p = state.player;

  // Timers
  p.pulseCooldown = Math.max(0, p.pulseCooldown - dt);
  p.pulseActiveTimer = Math.max(0, p.pulseActiveTimer - dt);
  p.invulnTimer = Math.max(0, p.invulnTimer - dt);

  // Overdrive sprint energy consumption / passive recharge
  const isManualMoving = Math.abs(input.moveNorth) > 0.05 || Math.abs(input.moveEast) > 0.05;
  const isRouteMoving = Boolean(state.route && state.route.path.length >= 2);
  const moving = isManualMoving || isRouteMoving;
  const wantsOverdrive = input.sprint && moving && p.energy > 4;
  p.overdriveActive = wantsOverdrive;

  if (wantsOverdrive) {
    p.energy = Math.max(0, p.energy - 22 * dt);
  } else {
    p.energy = Math.min(p.maxEnergy, p.energy + (moving ? 9 : 16) * dt);
  }

  const activeSpeed = wantsOverdrive ? OVERDRIVE_SPEED_MPS : BASE_RUNNER_SPEED_MPS;
  const prevPos = { ...p.position };

  // Movement: manual WASD overrides active route cleanly
  if (isManualMoving) {
    state.route = null;
    const mag = Math.hypot(input.moveNorth, input.moveEast);
    const nNorm = input.moveNorth / Math.max(1, mag);
    const eNorm = input.moveEast / Math.max(1, mag);
    const bearing = (Math.atan2(eNorm, nNorm) * RAD_TO_DEG + 360) % 360;
    const stepMeters = activeSpeed * dt;
    p.position = offsetLatLng(p.position, stepMeters, bearing);
    p.heading = bearing;
    p.vxMeters = eNorm * activeSpeed;
    p.vzMeters = nNorm * activeSpeed;
    p.distanceTraveledMeters += stepMeters;
  } else if (state.route && state.route.path.length >= 2) {
    const stepMeters = activeSpeed * dt;
    state.route.traveledMeters += stepMeters;
    const interp = interpolateAlongPath(state.route.path, state.route.traveledMeters);
    const actualMoved = haversineMeters(prevPos, interp.position);
    p.position = interp.position;
    p.heading = interp.heading;
    const rad = interp.heading * DEG_TO_RAD;
    p.vxMeters = Math.sin(rad) * activeSpeed;
    p.vzMeters = Math.cos(rad) * activeSpeed;
    p.distanceTraveledMeters += actualMoved;

    if (interp.arrived) {
      events.push({
        type: 'route_arrived',
        position: { ...p.position },
        label: state.route.targetName,
      });
      state.route = null;
    }
  } else {
    p.vxMeters = 0;
    p.vzMeters = 0;
  }

  // EMP / Aether Pulse shockwave
  if (input.triggerPulse && p.pulseCooldown <= 0 && p.energy >= PULSE_ENERGY_COST) {
    p.energy -= PULSE_ENERGY_COST;
    p.pulseCooldown = p.pulseMaxCooldown;
    p.pulseActiveTimer = 0.75;
    events.push({
      type: 'pulse_fired',
      position: { ...p.position },
      weight: 0.9,
    });

    for (const h of state.hunters) {
      if (h.defeated) continue;
      const dist = haversineMeters(p.position, h.position);
      if (dist <= p.pulseRadiusMeters) {
        h.hp -= 1;
        h.stunTimer = 5.5;
        h.telegraphTimer = 0;
        if (h.hp <= 0) {
          h.defeated = true;
          p.huntersNeutralized += 1;
          p.shards += 35;
          p.score += 180;
          events.push({
            type: 'hunter_neutralized',
            position: { ...h.position },
            label: h.name,
            weight: 1.0,
          });
        } else {
          p.score += 50;
          events.push({
            type: 'hunter_stunned',
            position: { ...h.position },
            label: h.name,
            weight: 0.65,
          });
        }
      }
    }

    // Pulse also magnetically pulls nearby Aether drops
    for (const drop of state.drops) {
      if (!drop.collected && haversineMeters(p.position, drop.position) <= p.pulseRadiusMeters) {
        drop.collected = true;
        p.shards += drop.shards;
        p.score += drop.shards * 5;
        p.energy = Math.min(p.maxEnergy, p.energy + 10);
        events.push({
          type: 'drop_collected',
          position: { ...drop.position },
          weight: 0.4,
        });
      }
    }
  }

  // Standard proximity pickup for roadside Aether drops
  for (const drop of state.drops) {
    if (!drop.collected && haversineMeters(p.position, drop.position) <= DROP_COLLECT_RADIUS_METERS) {
      drop.collected = true;
      p.shards += drop.shards;
      p.score += drop.shards * 5;
      p.energy = Math.min(p.maxEnergy, p.energy + 12);
      events.push({
        type: 'drop_collected',
        position: { ...drop.position },
        weight: 0.35,
      });
    }
  }

  // Update 3 distinct Hunter AI policies
  let closestHunterDist = Infinity;
  for (const h of state.hunters) {
    if (h.defeated) continue;
    h.attackCooldown = Math.max(0, h.attackCooldown - dt);

    if (h.stunTimer > 0) {
      h.stunTimer = Math.max(0, h.stunTimer - dt);
      continue;
    }

    const distToPlayer = haversineMeters(h.position, p.position);
    closestHunterDist = Math.min(closestHunterDist, distToPlayer);

    if (h.archetype === 'stalker') {
      // Stalker: patrols a wide circle until player enters 280m radar, then directly chases
      if (distToPlayer <= 280) {
        const b = bearingDegrees(h.position, p.position);
        h.heading = b;
        h.position = offsetLatLng(h.position, h.speedMps * dt, b);
      } else {
        h.orbitAngle += 0.45 * dt;
        const patrolTarget = offsetLatLng(h.home, 95, (h.orbitAngle * RAD_TO_DEG) % 360);
        const b = bearingDegrees(h.position, patrolTarget);
        h.heading = b;
        h.position = offsetLatLng(h.position, h.speedMps * 0.65 * dt, b);
      }

      if (distToPlayer <= 42 && h.attackCooldown <= 0 && p.invulnTimer <= 0) {
        p.integrity = Math.max(0, p.integrity - 14);
        p.invulnTimer = 1.3;
        h.attackCooldown = 2.4;
        events.push({
          type: 'player_hit',
          position: { ...p.position },
          label: h.name,
          weight: 0.8,
        });
      }
    } else if (h.archetype === 'interceptor') {
      // Interceptor: calculates predictive lead point ahead of player's velocity to cut across blocks
      if (distToPlayer <= 360) {
        const leadDist = Math.min(130, Math.hypot(p.vxMeters, p.vzMeters) * 2.6);
        const leadTarget =
          leadDist > 12 ? offsetLatLng(p.position, leadDist, p.heading) : p.position;
        const b = bearingDegrees(h.position, leadTarget);
        h.heading = b;
        h.position = offsetLatLng(h.position, h.speedMps * dt, b);
      } else {
        h.orbitAngle -= 0.65 * dt;
        const flankTarget = offsetLatLng(h.home, 130, (h.orbitAngle * RAD_TO_DEG + 360) % 360);
        const b = bearingDegrees(h.position, flankTarget);
        h.heading = b;
        h.position = offsetLatLng(h.position, h.speedMps * 0.72 * dt, b);
      }

      if (distToPlayer <= 44 && h.attackCooldown <= 0 && p.invulnTimer <= 0) {
        p.integrity = Math.max(0, p.integrity - 16);
        p.invulnTimer = 1.4;
        h.attackCooldown = 2.8;
        events.push({
          type: 'player_hit',
          position: { ...p.position },
          label: h.name,
          weight: 0.85,
        });
      }
    } else {
      // Rift Warden: guards Sanctuary; when player enters 155m, charges a telegraphed 1.5s disruption blast
      if (h.telegraphTimer > 0) {
        h.telegraphTimer += dt;
        if (h.telegraphTimer >= h.telegraphMax) {
          h.telegraphTimer = 0;
          h.attackCooldown = 3.6;
          events.push({
            type: 'warden_blast',
            position: { ...h.position },
            label: h.name,
            weight: 0.95,
          });
          if (distToPlayer <= 125 && p.invulnTimer <= 0) {
            p.integrity = Math.max(0, p.integrity - 22);
            p.invulnTimer = 1.6;
            events.push({
              type: 'player_hit',
              position: { ...p.position },
              label: `${h.name} Disruption Ring`,
              weight: 1.0,
            });
          }
        }
      } else {
        if (distToPlayer <= 155 && h.attackCooldown <= 0) {
          h.telegraphTimer = 0.01; // Begin visible warning ring
        } else {
          h.orbitAngle += 0.35 * dt;
          const guardTarget = offsetLatLng(h.home, 55, (h.orbitAngle * RAD_TO_DEG) % 360);
          const b = bearingDegrees(h.position, guardTarget);
          h.heading = b;
          h.position = offsetLatLng(h.position, h.speedMps * dt, b);
        }
      }
    }
  }

  // Threat telemetry (0..1) drives adaptive audio & warning cue
  state.threatLevel =
    closestHunterDist < 260 ? Math.max(0, Math.min(1, 1 - closestHunterDist / 260)) : 0;

  return {
    events,
    victory: state.capturedCount >= state.targetCaptures,
    defeat: p.integrity <= 0,
  };
}
