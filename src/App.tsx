import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, onFirebaseReady } from './firebase';
import { AdaptiveAudioEngine } from './game/audioEngine';
import {
  ensureMultiplayerRealm,
  ensureUserProfile,
  plantNarrativeBeacon,
  publishPlayerPresence,
  removePlayerPresence,
  restoreCloudSave,
  signInWithGoogle,
  signOutPlayer,
  subscribeToRealmMultiplayer,
  syncSaveToCloud,
} from './game/cloudSync';
import {
  CLAIM_RADIUS_METERS,
  createGeoSectorState,
  haversineMeters,
  spawnSectorDrops,
  spawnSectorHunters,
  stepGeoSimulation,
  type ActiveRouteState,
  type GeoSectorState,
  type LatLngLiteral,
  type MapLandmarkNode,
} from './game/geoEngine';
import {
  BIOME_PALETTES,
  buildQuestSynthesisContext,
  deriveBiomeFromCoords,
  generateEmergentQuest,
  getDominantFaction,
  resolveQuestChoice,
} from './game/questEngine';
import type {
  DynamicQuest,
  FactionId,
  GamePhase,
  NarrativeBeacon,
  PlayerSimState,
  RemoteWayfarer,
  ShrineNode,
  SoundMood,
  WorldState,
} from './game/types';
import { VectorMemoryStore } from './game/vectorMemory';
import { CURATED_SECTORS } from './components/PlaceSearchBar';
import { RealMapArena, type TacticalMapStyle } from './components/RealMapArena';
import { TitleOverlay } from './components/TitleOverlay';
import { GameHud } from './components/GameHud';
import { StatusModal } from './components/StatusModal';

const QuestMemoryDrawer = lazy(() =>
  import('./components/QuestMemoryDrawer').then((m) => ({ default: m.QuestMemoryDrawer }))
);
const SoundscapePanel = lazy(() =>
  import('./components/SoundscapePanel').then((m) => ({ default: m.SoundscapePanel }))
);
const CloudMultiplayerModal = lazy(() =>
  import('./components/CloudMultiplayerModal').then((m) => ({
    default: m.CloudMultiplayerModal,
  }))
);
const StreetViewReconModal = lazy(() =>
  import('./components/StreetViewReconModal').then((m) => ({
    default: m.StreetViewReconModal,
  }))
);

type ActiveModal = null | 'quests' | 'soundscape' | 'cloud' | 'streetview';

const DEFAULT_SECTOR = CURATED_SECTORS[0];

function createInitialWorld(center: LatLngLiteral, sectorLabel: string): WorldState {
  const derived = deriveBiomeFromCoords(center.lat, center.lng);
  return {
    realmId: derived.realmId,
    realmName: sectorLabel,
    biomeKey: derived.biomeKey,
    lat: center.lat,
    lng: center.lng,
    stability: 78,
    orderRep: 10,
    verdantRep: 8,
    unboundRep: 6,
    completedQuests: 0,
    discoveredShrines: [],
    mood: 'wonder',
  };
}

function toLegacyPlayerSnapshot(sector: GeoSectorState): PlayerSimState {
  const p = sector.player;
  return {
    x: p.position.lat,
    y: 0,
    z: p.position.lng,
    vx: p.vxMeters,
    vy: 0,
    vz: p.vzMeters,
    rotY: (p.heading * Math.PI) / 180,
    hp: p.integrity,
    maxHp: p.maxIntegrity,
    resonance: p.energy,
    shards: p.shards,
    level: p.level,
    xp: 0,
    grounded: true,
    coyoteTimer: 0,
    jumpBufferTimer: 0,
    dashTimer: 0,
    dashCooldown: 0,
    strikeTimer: 0,
    strikeCooldown: p.pulseCooldown,
    invulnTimer: p.invulnTimer,
    hitFlashTimer: 0,
    walkDistance: p.distanceTraveledMeters,
    squashY: 1,
    defeatedCount: p.huntersNeutralized,
  };
}

function toLegacyShrines(nodes: MapLandmarkNode[]): ShrineNode[] {
  return nodes.map((n, idx) => ({
    id: n.id,
    name: n.name,
    x: n.position.lat,
    z: n.position.lng,
    faction:
      n.kind === 'sanctuary'
        ? 'order'
        : n.kind === 'supply'
          ? 'verdant'
          : idx % 2 === 0
            ? 'unbound'
            : 'neutral',
    attuned: n.captured,
    color: 0xe5a94c,
  }));
}

export default function App() {
  const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
  const audioRef = useRef<AdaptiveAudioEngine | null>(null);
  const memoryStoreRef = useRef<VectorMemoryStore>(VectorMemoryStore.loadFromBrowser());

  const initialCenter = DEFAULT_SECTOR.center;
  const initialLabel = `${DEFAULT_SECTOR.label} · ${DEFAULT_SECTOR.region}`;

  const sectorRef = useRef<GeoSectorState>(
    createGeoSectorState({
      sectorId: DEFAULT_SECTOR.id,
      sectorName: initialLabel,
      center: initialCenter,
    })
  );

  // React render snapshot synced at ~20Hz during active gameplay
  const [sectorSnap, setSectorSnap] = useState<GeoSectorState>(() => ({
    ...sectorRef.current,
    player: { ...sectorRef.current.player, position: { ...sectorRef.current.player.position } },
    nodes: sectorRef.current.nodes.map((n) => ({ ...n })),
    hunters: sectorRef.current.hunters.map((h) => ({ ...h })),
    drops: sectorRef.current.drops.map((d) => ({ ...d })),
  }));

  const [phase, setPhase] = useState<GamePhase>('title');
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [mapStyle, setMapStyle] = useState<TacticalMapStyle>('dark');
  const [panTrigger, setPanTrigger] = useState(0);
  const [scanTrigger, setScanTrigger] = useState(0);
  const [realPlacesCount, setRealPlacesCount] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [streetViewNode, setStreetViewNode] = useState<MapLandmarkNode | null>(null);
  const [routeTarget, setRouteTarget] = useState<{
    position: LatLngLiteral;
    nodeId: string | null;
    label: string;
    requestId: number;
  } | null>(null);
  const [eventBanner, setEventBanner] = useState<string | null>(null);
  const [overdriveLocked, setOverdriveLocked] = useState(false);

  const [world, setWorld] = useState<WorldState>(() =>
    createInitialWorld(initialCenter, initialLabel)
  );
  const [memoryVersion, setMemoryVersion] = useState(0);

  // Dynamic Emergent Quest state
  const [activeQuest, setActiveQuest] = useState<DynamicQuest | null>(() =>
    generateEmergentQuest({
      world: createInitialWorld(initialCenter, initialLabel),
      player: toLegacyPlayerSnapshot(sectorRef.current),
      shrines: toLegacyShrines(sectorRef.current.nodes),
      memoryStore: memoryStoreRef.current,
    })
  );
  const [deepQuestBusy, setDeepQuestBusy] = useState(false);
  const [deepQuestError, setDeepQuestError] = useState<string | null>(null);

  // Audio state
  const [isMuted, setIsMuted] = useState(false);

  // Firebase Auth, Cloud Save & Live Multiplayer state
  const [user, setUser] = useState<User | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [remotePlayers, setRemotePlayers] = useState<RemoteWayfarer[]>([]);
  const [beacons, setBeacons] = useState<NarrativeBeacon[]>([]);

  // Google Maps Demo Key Quota Banner state (Tier 2)
  const [gmpQuotaExceeded, setGmpQuotaExceeded] = useState(false);

  // Live Input Refs
  const keysRef = useRef<Set<string>>(new Set());
  const pulseQueuedRef = useRef(false);
  const overdriveLockedRef = useRef(false);
  overdriveLockedRef.current = overdriveLocked;
  const phaseRef = useRef<GamePhase>(phase);
  phaseRef.current = phase;
  const activeModalRef = useRef<ActiveModal>(activeModal);
  activeModalRef.current = activeModal;
  const worldRef = useRef<WorldState>(world);
  worldRef.current = world;
  const bannerTimerRef = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setEventBanner(msg);
    if (bannerTimerRef.current !== null) {
      window.clearTimeout(bannerTimerRef.current);
    }
    bannerTimerRef.current = window.setTimeout(() => {
      setEventBanner(null);
    }, 3200);
  }, []);

  const syncSnapshot = useCallback(() => {
    const s = sectorRef.current;
    setSectorSnap({
      ...s,
      player: { ...s.player, position: { ...s.player.position } },
      nodes: s.nodes.map((n) => ({ ...n })),
      hunters: s.hunters.map((h) => ({ ...h, position: { ...h.position } })),
      drops: s.drops.map((d) => ({ ...d })),
      route: s.route ? { ...s.route } : null,
    });
  }, []);

  // Listen for Google Maps Demo Key Quota Exceeded event
  useEffect(() => {
    const onQuota = () => setGmpQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuota);
  }, []);

  // Support ?autostart=1 for automated testing and direct entry
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      setPhase('playing');
    }
  }, []);

  // Mirror phase cleanly onto document.body.dataset.state
  useEffect(() => {
    const bodyState = phase === 'victory' ? 'gameover' : phase;
    document.body.dataset.state = bodyState;
  }, [phase]);

  // Sync adaptive audio mood
  useEffect(() => {
    audioRef.current?.setMood(world.mood);
  }, [world.mood]);

  // Non-blocking Firebase Auth listener (attaches immediately when background initFirebase finishes)
  useEffect(() => {
    let unsubAuth: (() => void) | null = null;
    const unsubReady = onFirebaseReady(() => {
      if (!auth) return;
      unsubAuth = onAuthStateChanged(auth, (nextUser) => {
        setUser(nextUser);
        if (nextUser && nextUser.emailVerified) {
          void ensureUserProfile(nextUser).catch(() => {});
        }
      });
    });
    return () => {
      unsubReady();
      unsubAuth?.();
    };
  }, []);

  // Cross-platform Live Multiplayer Presence & Shared Beacons (using real lat/lng coordinates!)
  useEffect(() => {
    if (!user || !user.emailVerified || phase !== 'playing') {
      setRemotePlayers([]);
      setBeacons([]);
      return;
    }

    let unsub: (() => void) | null = null;
    let presenceTimer: number | null = null;
    let active = true;
    const realmId = world.realmId;

    void (async () => {
      try {
        await ensureMultiplayerRealm(user, worldRef.current);
        if (!active) return;

        unsub = subscribeToRealmMultiplayer(
          user,
          realmId,
          (players) => setRemotePlayers(players),
          (nextBeacons) => setBeacons(nextBeacons)
        );

        await publishPlayerPresence(
          user,
          realmId,
          toLegacyPlayerSnapshot(sectorRef.current),
          worldRef.current
        );

        presenceTimer = window.setInterval(() => {
          if (phaseRef.current === 'playing') {
            void publishPlayerPresence(
              user,
              realmId,
              toLegacyPlayerSnapshot(sectorRef.current),
              worldRef.current
            ).catch(() => {});
          }
        }, 2200);
      } catch {
        // Offline or rules restriction; local gameplay continues smoothly
      }
    })();

    return () => {
      active = false;
      if (presenceTimer !== null) window.clearInterval(presenceTimer);
      unsub?.();
      void removePlayerPresence(user, realmId);
    };
  }, [user, phase, world.realmId]);

  const startGameplay = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new AdaptiveAudioEngine();
    }
    audioRef.current.start();
    audioRef.current.setMood(worldRef.current.mood);
    keysRef.current.clear();
    setActiveModal(null);
    setPhase('playing');
  }, []);

  const handleTogglePause = useCallback(() => {
    if (activeModalRef.current !== null) {
      setActiveModal(null);
      setStreetViewNode(null);
      return;
    }
    keysRef.current.clear();
    setPhase((prev) => {
      if (prev === 'playing') return 'paused';
      if (prev === 'paused') return 'playing';
      return prev;
    });
  }, []);

  // Jump to any real city / GPS coordinate on Earth
  const handleSelectDestination = useCallback(
    (center: LatLngLiteral, label: string) => {
      const derived = deriveBiomeFromCoords(center.lat, center.lng);
      const prevPlayer = sectorRef.current.player;

      sectorRef.current = createGeoSectorState({
        sectorId: derived.realmId,
        sectorName: label,
        center,
        carryShards: prevPlayer.shards,
        carryScore: prevPlayer.score,
        carryLevel: prevPlayer.level,
      });

      setRouteTarget(null);
      setSelectedNodeId(null);
      setRealPlacesCount(0);
      setWorld((prev) => ({
        ...prev,
        realmId: derived.realmId,
        realmName: label,
        biomeKey: derived.biomeKey,
        lat: center.lat,
        lng: center.lng,
      }));
      setPanTrigger((n) => n + 1);
      setScanTrigger((n) => n + 1);
      syncSnapshot();
      showToast(`Deployed to ${label}. Scanning nearby real places...`);
    },
    [showToast, syncSnapshot]
  );

  // Callback when RealMapArena finishes Places API (New) `searchNearby`
  const handleNodesScanned = useCallback(
    (scannedNodes: MapLandmarkNode[], realCount: number) => {
      const s = sectorRef.current;
      s.nodes = scannedNodes;
      s.targetCaptures = Math.min(5, Math.max(3, scannedNodes.length));
      s.capturedCount = scannedNodes.filter((n) => n.captured).length;
      s.drops = spawnSectorDrops(s.center, scannedNodes);
      s.hunters = spawnSectorHunters(s.center, scannedNodes, s.player.level);
      setRealPlacesCount(realCount);
      setSelectedNodeId(scannedNodes[0]?.id ?? null);
      syncSnapshot();

      if (phaseRef.current === 'playing') {
        showToast(
          realCount > 0
            ? `Scanned ${realCount} real landmarks in ${s.sectorName}.`
            : `Tactical signal relays deployed across ${s.sectorName}.`
        );
      }
    },
    [showToast, syncSnapshot]
  );

  const handleRouteComputed = useCallback(
    (route: ActiveRouteState) => {
      sectorRef.current.route = route;
      syncSnapshot();
      audioRef.current?.playSfx('dash', 0.45);
    },
    [syncSnapshot]
  );

  const handleRouteToNode = useCallback((node: MapLandmarkNode) => {
    setSelectedNodeId(node.id);
    setRouteTarget({
      position: node.position,
      nodeId: node.id,
      label: node.name,
      requestId: Date.now(),
    });
  }, []);

  const handleMapClick = useCallback((pos: LatLngLiteral) => {
    setRouteTarget({
      position: pos,
      nodeId: null,
      label: `Street Waypoint (${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)})`,
      requestId: Date.now(),
    });
  }, []);

  const handleClaimNode = useCallback(
    (node: MapLandmarkNode) => {
      const s = sectorRef.current;
      const target = s.nodes.find((n) => n.id === node.id);
      if (!target || target.captured) return;

      const dist = haversineMeters(s.player.position, target.position);
      if (dist > CLAIM_RADIUS_METERS) {
        handleRouteToNode(target);
        showToast(`Move within ${CLAIM_RADIUS_METERS}m of ${target.name} to claim it.`);
        return;
      }

      target.captured = true;
      s.capturedCount = s.nodes.filter((n) => n.captured).length;

      // Apply kind-specific tactical rewards
      s.player.shards += target.rewardShards;
      s.player.score += target.kind === 'sanctuary' ? 250 : target.kind === 'transit' ? 180 : 150;
      if (target.kind === 'supply') {
        s.player.energy = Math.min(s.player.maxEnergy, s.player.energy + 45);
        s.player.integrity = Math.min(s.player.maxIntegrity, s.player.integrity + 25);
      } else if (target.kind === 'transit') {
        s.player.pulseCooldown = 0;
        s.player.energy = Math.min(s.player.maxEnergy, s.player.energy + 30);
      } else {
        s.player.integrity = Math.min(s.player.maxIntegrity, s.player.integrity + 12);
      }

      audioRef.current?.playSfx('quest_complete', 0.85);

      const store = memoryStoreRef.current;
      store.addMemory({
        summary: `Claimed ${target.kind} node in ${s.sectorName} (${s.capturedCount}/${s.targetCaptures} sector control).`,
        category: 'discovery',
        factionTag: getDominantFaction(worldRef.current),
        importance: 7,
      });
      store.saveToBrowser();
      setMemoryVersion((v) => v + 1);

      syncSnapshot();

      // Check Sector Victory
      if (s.capturedCount >= s.targetCaptures) {
        setRouteTarget(null);
        setActiveModal(null);
        setPhase('victory');
        return;
      }

      // Open dynamic emergent quest on Sanctuary captures
      if (target.kind === 'sanctuary') {
        const nextQuest = generateEmergentQuest({
          world: worldRef.current,
          player: toLegacyPlayerSnapshot(s),
          shrines: toLegacyShrines(s.nodes),
          memoryStore: store,
          focusShrineId: target.id,
        });
        setActiveQuest(nextQuest);
        setDeepQuestError(null);
        setActiveModal('quests');
      } else {
        showToast(
          `Claimed ${target.name}! +${target.rewardShards} Shards (${s.capturedCount}/${s.targetCaptures})`
        );
      }
    },
    [handleRouteToNode, showToast, syncSnapshot]
  );

  // Main real-map simulation loop (~20Hz smooth updates, paused when tab hidden or modal open)
  useEffect(() => {
    let lastTime = performance.now();
    const intervalId = window.setInterval(() => {
      if (document.hidden || phaseRef.current !== 'playing' || activeModalRef.current !== null) {
        lastTime = performance.now();
        return;
      }

      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.005, (now - lastTime) / 1000));
      lastTime = now;

      const keys = keysRef.current;
      const moveNorth =
        (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) -
        (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
      const moveEast =
        (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) -
        (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      const sprint =
        overdriveLockedRef.current || keys.has('ShiftLeft') || keys.has('ShiftRight');
      const triggerPulse = pulseQueuedRef.current;
      pulseQueuedRef.current = false;

      if (moveNorth !== 0 || moveEast !== 0) {
        setRouteTarget(null);
      }

      const { events, defeat } = stepGeoSimulation(
        sectorRef.current,
        { moveNorth, moveEast, sprint, triggerPulse },
        dt
      );

      for (const ev of events) {
        if (ev.type === 'pulse_fired') {
          audioRef.current?.playSfx('strike', 0.9);
          showToast('EMP Pulse discharged! Hunters inside 220m stunned.');
        } else if (ev.type === 'hunter_neutralized') {
          audioRef.current?.playSfx('enemy_ko', 1.0);
          showToast(`Neutralized ${ev.label}! +35 Shards · +180 Score`);
        } else if (ev.type === 'player_hit') {
          audioRef.current?.playSfx('player_hurt', 0.85);
          showToast(`Hit by ${ev.label}! Use EMP Pulse [Space] or Overdrive!`);
        } else if (ev.type === 'warden_blast') {
          audioRef.current?.playSfx('enemy_telegraph', 0.9);
        } else if (ev.type === 'drop_collected') {
          audioRef.current?.playSfx('jump', 0.45);
        } else if (ev.type === 'route_arrived') {
          setRouteTarget(null);
          showToast(`Arrived at ${ev.label}.`);
        }
      }

      audioRef.current?.setThreat(sectorRef.current.threatLevel);
      syncSnapshot();

      if (defeat) {
        setRouteTarget(null);
        setActiveModal(null);
        setPhase('gameover');
      }
    }, 50);

    return () => window.clearInterval(intervalId);
  }, [showToast, syncSnapshot]);

  // Unified Keyboard Input Listener & Focus-Loss Hygiene
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (phaseRef.current === 'title' && (e.code === 'Enter' || e.code === 'Space')) {
        e.preventDefault();
        startGameplay();
        return;
      }

      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (phaseRef.current === 'playing' || phaseRef.current === 'paused') {
          e.preventDefault();
          handleTogglePause();
        }
        return;
      }

      if (phaseRef.current !== 'playing') return;

      if (e.code === 'KeyQ') {
        e.preventDefault();
        setActiveModal((m) => (m === 'quests' ? null : 'quests'));
        return;
      }
      if (e.code === 'KeyM') {
        e.preventDefault();
        setActiveModal((m) => (m === 'soundscape' ? null : 'soundscape'));
        return;
      }
      if (e.code === 'KeyC') {
        e.preventDefault();
        setActiveModal((m) => (m === 'cloud' ? null : 'cloud'));
        return;
      }

      if (activeModalRef.current !== null) return;

      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        pulseQueuedRef.current = true;
        return;
      }

      if (e.code === 'KeyE' && !e.repeat) {
        e.preventDefault();
        const s = sectorRef.current;
        const candidate = s.nodes
          .filter((n) => !n.captured)
          .map((n) => ({ node: n, dist: haversineMeters(s.player.position, n.position) }))
          .sort((a, b) => a.dist - b.dist)[0];
        if (candidate && candidate.dist <= CLAIM_RADIUS_METERS) {
          handleClaimNode(candidate.node);
        }
        return;
      }

      keysRef.current.add(e.code);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.code);
    };

    const clearKeys = () => {
      keysRef.current.clear();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearKeys);
    document.addEventListener('visibilitychange', clearKeys);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearKeys);
      document.removeEventListener('visibilitychange', clearKeys);
    };
  }, [startGameplay, handleTogglePause, handleClaimNode]);

  // Quest resolution with real-map rewards & optional Hunter wave
  const handleSelectQuestChoice = (choiceId: string) => {
    if (!activeQuest || activeQuest.status !== 'active') return;
    const store = memoryStoreRef.current;
    const s = sectorRef.current;

    const result = resolveQuestChoice({
      quest: activeQuest,
      choiceId,
      world,
      player: toLegacyPlayerSnapshot(s),
      memoryStore: store,
    });

    s.player.shards += result.playerRewards.shardReward;
    s.player.score += result.playerRewards.shardReward * 4;
    s.player.integrity = Math.min(
      s.player.maxIntegrity,
      s.player.integrity + result.playerRewards.healAmount
    );
    if (result.playerRewards.spawnSentinelWave) {
      s.player.level += 1;
      const extra = spawnSectorHunters(s.player.position, s.nodes, s.player.level);
      s.hunters = [...s.hunters.filter((h) => !h.defeated), extra[0]];
    }

    audioRef.current?.playSfx('quest_complete', 0.8);
    setActiveQuest(result.updatedQuest);
    setWorld(result.updatedWorld);
    setMemoryVersion((v) => v + 1);
    syncSnapshot();
  };

  const handleWeaveLocalQuest = () => {
    setDeepQuestError(null);
    const q = generateEmergentQuest({
      world,
      player: toLegacyPlayerSnapshot(sectorRef.current),
      shrines: toLegacyShrines(sectorRef.current.nodes),
      memoryStore: memoryStoreRef.current,
    });
    setActiveQuest(q);
  };

  const handleSynthesizeDeepQuest = async () => {
    setDeepQuestBusy(true);
    setDeepQuestError(null);
    try {
      const store = memoryStoreRef.current;
      const shrines = toLegacyShrines(sectorRef.current.nodes);
      const shrine = shrines.find((s) => !s.attuned) || shrines[0];
      const memories = store.query(
        `${getDominantFaction(world)} ${world.realmName} ${shrine.name}`,
        4
      );
      const contextText = buildQuestSynthesisContext({
        world,
        player: toLegacyPlayerSnapshot(sectorRef.current),
        shrine,
        memories,
      });

      const res = await fetch('/api/narrative/quest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contextText,
          shrineId: shrine.id,
          shrineName: shrine.name,
        }),
      });
      const data = (await res.json()) as { quest?: DynamicQuest; error?: string };
      if (!res.ok || !data.quest || !data.quest.choices?.length) {
        throw new Error(data.error || 'Unable to synthesize AI quest.');
      }
      setActiveQuest(data.quest);
    } catch (err) {
      setDeepQuestError(err instanceof Error ? err.message : 'Quest synthesis failed.');
    } finally {
      setDeepQuestBusy(false);
    }
  };

  const handleRecordCustomMemory = (text: string, faction: FactionId) => {
    const store = memoryStoreRef.current;
    store.addMemory({
      summary: text,
      category: 'discovery',
      factionTag: faction,
      importance: 8,
    });
    store.saveToBrowser();
    setMemoryVersion((v) => v + 1);
  };

  const handleRestartSector = () => {
    const cur = sectorRef.current;
    const resetNodes = cur.nodes.map((n) => ({ ...n, captured: false }));
    sectorRef.current = createGeoSectorState({
      sectorId: cur.sectorId,
      sectorName: cur.sectorName,
      center: cur.center,
      nodes: resetNodes,
    });
    setRouteTarget(null);
    setActiveModal(null);
    setOverdriveLocked(false);
    keysRef.current.clear();
    syncSnapshot();
    setPhase('playing');
  };

  // Firebase Auth & Cloud Sync handlers
  const handleGoogleSignIn = async () => {
    setAuthBusy(true);
    setAuthError(null);
    setSyncError(null);
    try {
      const signedInUser = await signInWithGoogle();
      setUser(signedInUser);
      setSyncMessage('Signed in with Google. Cloud sync & live multiplayer active.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google sign-in was cancelled or blocked.';
      setAuthError(msg);
      setSyncError(msg);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    await signOutPlayer();
    setUser(null);
    setSyncMessage('Signed out. Continuing in local mode.');
  };

  const handleUploadCloudSave = async () => {
    if (!user) return;
    setSyncBusy(true);
    setSyncError(null);
    setSyncMessage(null);
    try {
      const { memoriesUploaded } = await syncSaveToCloud(
        user,
        world,
        toLegacyPlayerSnapshot(sectorRef.current),
        memoryStoreRef.current
      );
      setSyncMessage(
        `Cloud save updated (${world.realmName}) and ${memoriesUploaded} new vector memories synced.`
      );
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Cloud sync failed.');
    } finally {
      setSyncBusy(false);
    }
  };

  const handleRestoreCloudSave = async () => {
    if (!user) return;
    setSyncBusy(true);
    setSyncError(null);
    setSyncMessage(null);
    try {
      const { save, memoriesMerged } = await restoreCloudSave(user, memoryStoreRef.current);
      if (save) {
        const restoredCenter = { lat: save.lat, lng: save.lng };
        handleSelectDestination(restoredCenter, save.slotLabel || 'Restored Sector');
        sectorRef.current.player.shards = save.shards;
        sectorRef.current.player.level = save.level;
        sectorRef.current.player.integrity = Math.max(25, save.hp);
        syncSnapshot();
        setMemoryVersion((v) => v + 1);
        setSyncMessage(
          `Restored ${save.slotLabel} and merged ${memoriesMerged} vector memories.`
        );
      } else {
        setSyncMessage('No previous cloud save found for this account yet.');
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Unable to restore cloud save.');
    } finally {
      setSyncBusy(false);
    }
  };

  const handlePlantBeacon = async (message: string) => {
    if (!user) return;
    setSyncError(null);
    try {
      await plantNarrativeBeacon(
        user,
        world.realmId,
        message,
        sectorRef.current.player.position.lat,
        sectorRef.current.player.position.lng,
        getDominantFaction(world)
      );
      setSyncMessage('Shared beacon planted at your live map coordinate.');
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Could not plant beacon.');
    }
  };

  const selectedNode = useMemo(
    () => sectorSnap.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [sectorSnap.nodes, selectedNodeId]
  );

  const nearestUnclaimedNode = useMemo(() => {
    let best: { node: MapLandmarkNode; distance: number } | null = null;
    for (const n of sectorSnap.nodes) {
      if (n.captured) continue;
      const dist = haversineMeters(sectorSnap.player.position, n.position);
      if (!best || dist < best.distance) {
        best = { node: n, distance: dist };
      }
    }
    return best;
  }, [sectorSnap.nodes, sectorSnap.player.position]);

  const memoryCount = useMemo(() => {
    void memoryVersion;
    return memoryStoreRef.current.count();
  }, [memoryVersion]);

  const content = (
    <div className="relative h-screen w-screen overflow-hidden bg-[#0e131d] text-[#f2ece1]">
      {/* Google Maps Platform Quota Banner (Case A — compact sticky top bar) */}
      {gmpQuotaExceeded && (
        <div
          role="alert"
          className="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center justify-between gap-2 border-b border-amber-300/60 bg-amber-950/95 px-4 py-2 text-xs text-amber-100"
        >
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold underline hover:text-amber-300"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
          <button
            type="button"
            onClick={() => setGmpQuotaExceeded(false)}
            className="cursor-pointer border border-amber-300/40 px-2 py-0.5 text-[11px] uppercase hover:bg-amber-900"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Full-Viewport Live Google Maps Arena */}
      {mapsApiKey ? (
        <RealMapArena
          center={sectorSnap.center}
          panTrigger={panTrigger}
          scanTrigger={scanTrigger}
          followPlayer={phase === 'playing'}
          mapStyle={mapStyle}
          isPlaying={phase === 'playing'}
          player={sectorSnap.player}
          nodes={sectorSnap.nodes}
          hunters={sectorSnap.hunters}
          drops={sectorSnap.drops}
          selectedNodeId={selectedNodeId}
          routeTarget={routeTarget}
          remotePlayers={remotePlayers}
          beacons={beacons}
          onNodesScanned={handleNodesScanned}
          onRouteComputed={handleRouteComputed}
          onSelectNode={(node) => {
            setSelectedNodeId(node.id);
            if (phase === 'playing' && !node.captured) {
              const dist = haversineMeters(sectorRef.current.player.position, node.position);
              if (dist <= CLAIM_RADIUS_METERS) {
                handleClaimNode(node);
              } else {
                handleRouteToNode(node);
              }
            }
          }}
          onMapClick={handleMapClick}
        />
      ) : (
        <div className="fixed inset-0 flex items-center justify-center bg-[#0e131d] p-6 text-center text-sm text-[#b5bece]">
          Google Maps API key (`VITE_GOOGLE_MAPS_API_KEY`) is not configured in this environment.
        </div>
      )}

      {/* Transient Event Toast (top-center, non-blocking) */}
      {eventBanner && phase === 'playing' && (
        <div
          role="status"
          className="pointer-events-none fixed top-16 left-1/2 z-30 -translate-x-1/2 border border-[#e5a94c]/55 bg-[#0c111b]/95 px-4 py-1.5 text-xs font-semibold text-[#f7dca2] shadow-xl"
        >
          {eventBanner}
        </div>
      )}

      {/* Title Screen Overlay over Live Real Map */}
      {phase === 'title' && (
        <TitleOverlay
          sectorName={sectorSnap.sectorName}
          realPlacesCount={realPlacesCount}
          user={user}
          authBusy={authBusy}
          authError={authError}
          memoryCount={memoryCount}
          onSelectDestination={handleSelectDestination}
          onStart={startGameplay}
          onSignIn={handleGoogleSignIn}
        />
      )}

      {/* Live Gameplay Perimeter HUD */}
      {phase === 'playing' && (
        <GameHud
          sectorName={sectorSnap.sectorName}
          player={sectorSnap.player}
          nodes={sectorSnap.nodes}
          capturedCount={sectorSnap.capturedCount}
          targetCaptures={sectorSnap.targetCaptures}
          threatLevel={sectorSnap.threatLevel}
          activeRoute={sectorSnap.route}
          selectedNode={selectedNode}
          nearestUnclaimedNode={nearestUnclaimedNode}
          world={world}
          activeQuest={activeQuest}
          remotePlayerCount={remotePlayers.length}
          mapStyle={mapStyle}
          isMuted={isMuted}
          onChangeMapStyle={setMapStyle}
          onSelectDestination={handleSelectDestination}
          onRescanSector={() => {
            sectorRef.current.center = { ...sectorRef.current.player.position };
            setScanTrigger((n) => n + 1);
            showToast('Scanning real nearby places around your current position...');
          }}
          onRecenter={() => {
            sectorRef.current.center = { ...sectorRef.current.player.position };
            setPanTrigger((n) => n + 1);
            syncSnapshot();
          }}
          onTriggerPulse={() => {
            pulseQueuedRef.current = true;
          }}
          onToggleOverdrive={() => setOverdriveLocked((v) => !v)}
          onClaimNode={handleClaimNode}
          onOpenStreetView={(node) => {
            setStreetViewNode(node);
            setActiveModal('streetview');
          }}
          onRouteToNode={handleRouteToNode}
          onOpenQuests={() => setActiveModal('quests')}
          onOpenSoundscape={() => setActiveModal('soundscape')}
          onOpenCloud={() => setActiveModal('cloud')}
          onTogglePause={handleTogglePause}
        />
      )}

      {/* Lazy-Loaded Secondary Modals */}
      <Suspense fallback={null}>
        {activeModal === 'quests' && (
          <QuestMemoryDrawer
            open
            quest={activeQuest}
            world={world}
            memoryStore={memoryStoreRef.current}
            memoryVersion={memoryVersion}
            deepQuestBusy={deepQuestBusy}
            deepQuestError={deepQuestError}
            onClose={() => setActiveModal(null)}
            onSelectChoice={handleSelectQuestChoice}
            onWeaveLocalQuest={handleWeaveLocalQuest}
            onSynthesizeDeepQuest={handleSynthesizeDeepQuest}
            onRecordCustomMemory={handleRecordCustomMemory}
          />
        )}

        {activeModal === 'soundscape' && (
          <SoundscapePanel
            open
            mood={world.mood}
            threat={sectorSnap.threatLevel}
            biomeName={BIOME_PALETTES[world.biomeKey].name}
            isMuted={isMuted}
            onClose={() => setActiveModal(null)}
            onToggleMute={() => {
              const next = !isMuted;
              setIsMuted(next);
              audioRef.current?.setMuted(next);
            }}
            onSelectMood={(nextMood: SoundMood) => {
              setWorld((prev) => ({ ...prev, mood: nextMood }));
            }}
            onSetDucked={(ducked) => audioRef.current?.setDucked(ducked)}
          />
        )}

        {activeModal === 'cloud' && (
          <CloudMultiplayerModal
            open
            user={user}
            world={world}
            remotePlayers={remotePlayers}
            beacons={beacons}
            syncBusy={syncBusy}
            syncMessage={syncMessage}
            syncError={syncError}
            showTouchControls={false}
            onClose={() => setActiveModal(null)}
            onSignIn={handleGoogleSignIn}
            onSignOut={handleSignOut}
            onUploadSave={handleUploadCloudSave}
            onRestoreSave={handleRestoreCloudSave}
            onPlantBeacon={handlePlantBeacon}
            onToggleTouchControls={() => {}}
          />
        )}

        {activeModal === 'streetview' && streetViewNode && (
          <StreetViewReconModal
            node={streetViewNode}
            onClose={() => {
              setStreetViewNode(null);
              setActiveModal(null);
            }}
          />
        )}
      </Suspense>

      {/* Pause / Victory / Defeat Modal */}
      <StatusModal
        phase={phase}
        sectorName={sectorSnap.sectorName}
        player={sectorSnap.player}
        capturedCount={sectorSnap.capturedCount}
        targetCaptures={sectorSnap.targetCaptures}
        memoryCount={memoryCount}
        onResume={() => setPhase('playing')}
        onRestart={handleRestartSector}
        onReturnTitle={() => {
          setActiveModal(null);
          setRouteTarget(null);
          setPhase('title');
        }}
      />
    </div>
  );

  return mapsApiKey ? (
    <APIProvider apiKey={mapsApiKey} language="en" region="US">
      {content}
    </APIProvider>
  ) : (
    content
  );
}
