import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, isFirebaseReady } from './firebase';
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
  BIOME_PALETTES,
  buildQuestSynthesisContext,
  deriveBiomeFromCoords,
  generateEmergentQuest,
  getDominantFaction,
  resolveQuestChoice,
} from './game/questEngine';
import {
  createInitialSimulation,
  groundHeightAt,
  spawnDifficultyWave,
  type SimEvent,
  type SimulationState,
} from './game/simulation';
import { ThreeWorldEngine } from './game/ThreeWorldEngine';
import type {
  DynamicQuest,
  FactionId,
  GamePhase,
  HudSnapshot,
  NarrativeBeacon,
  RemoteWayfarer,
  SoundMood,
  WorldState,
} from './game/types';
import { VectorMemoryStore } from './game/vectorMemory';
import { TitleOverlay } from './components/TitleOverlay';
import { GameHud } from './components/GameHud';
import { MobileTouchControls } from './components/MobileTouchControls';
import { QuestMemoryDrawer } from './components/QuestMemoryDrawer';
import { SoundscapePanel } from './components/SoundscapePanel';
import { VoiceOracleModal } from './components/VoiceOracleModal';
import { WorldAtlasModal } from './components/WorldAtlasModal';
import { CloudMultiplayerModal } from './components/CloudMultiplayerModal';
import { StatusModal } from './components/StatusModal';

type ActiveModal = null | 'quests' | 'soundscape' | 'voice' | 'atlas' | 'cloud';

function createInitialWorldState(): WorldState {
  const lat = 46.5197;
  const lng = 6.6323;
  const derived = deriveBiomeFromCoords(lat, lng);
  return {
    realmId: derived.realmId,
    realmName: derived.realmName,
    biomeKey: derived.biomeKey,
    lat,
    lng,
    stability: 74,
    orderRep: 10,
    verdantRep: 8,
    unboundRep: 6,
    completedQuests: 0,
    discoveredShrines: [],
    mood: 'wonder',
  };
}

function createInitialHud(biomeName: string): HudSnapshot {
  return {
    hp: 100,
    maxHp: 100,
    resonance: 100,
    shards: 15,
    level: 1,
    defeatedCount: 0,
    stability: 74,
    biomeName,
    nearestShrine: null,
    activeEnemyThreat: 0,
    playerX: 0,
    playerZ: 6,
    dashReady: true,
    strikeReady: true,
  };
}

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<ThreeWorldEngine | null>(null);
  const simRef = useRef<SimulationState>(createInitialSimulation(BIOME_PALETTES.highland_dusk.seedOffset));
  const audioRef = useRef<AdaptiveAudioEngine | null>(null);
  const memoryStoreRef = useRef<VectorMemoryStore>(VectorMemoryStore.loadFromBrowser());

  const [phase, setPhase] = useState<GamePhase>('title');
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [world, setWorld] = useState<WorldState>(createInitialWorldState);
  const [hud, setHud] = useState<HudSnapshot>(() =>
    createInitialHud(BIOME_PALETTES.highland_dusk.name)
  );
  const [memoryVersion, setMemoryVersion] = useState(0);

  // Dynamic quest state
  const [activeQuest, setActiveQuest] = useState<DynamicQuest | null>(() =>
    generateEmergentQuest({
      world: createInitialWorldState(),
      player: simRef.current.player,
      shrines: simRef.current.shrines,
      memoryStore: memoryStoreRef.current,
    })
  );
  const [deepQuestBusy, setDeepQuestBusy] = useState(false);
  const [deepQuestError, setDeepQuestError] = useState<string | null>(null);

  // Audio state
  const [isMuted, setIsMuted] = useState(false);

  // Firebase Auth, Cloud Save & Multiplayer state
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

  // Mobile Touch Controls visibility (auto-detect coarse pointer or < 900px)
  const [touchOverride, setTouchOverride] = useState<boolean | null>(null);
  const [isCompactViewport, setIsCompactViewport] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.innerWidth < 900 ||
      window.matchMedia('(pointer: coarse)').matches
    );
  });
  const showTouchControls = touchOverride ?? isCompactViewport;

  // Refs to avoid stale closures inside ThreeWorldEngine callbacks
  const phaseRef = useRef<GamePhase>(phase);
  phaseRef.current = phase;
  const worldRef = useRef<WorldState>(world);
  worldRef.current = world;
  const activeModalRef = useRef<ActiveModal>(activeModal);
  activeModalRef.current = activeModal;

  // Listen for viewport resize / touch capability changes
  useEffect(() => {
    const onResize = () => {
      setIsCompactViewport(
        window.innerWidth < 900 || window.matchMedia('(pointer: coarse)').matches
      );
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Listen for Google Maps Demo Key Quota Exceeded event (Tier 2)
  useEffect(() => {
    const onQuota = () => setGmpQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuota);
  }, []);

  // Mirror phase cleanly onto document.body.dataset.state & ThreeWorldEngine
  useEffect(() => {
    const bodyState = phase === 'victory' ? 'paused' : phase;
    document.body.dataset.state = bodyState;
    // Pause live movement when any narrative/atlas modal is open so player is never ambushed
    const enginePhase: GamePhase =
      phase === 'playing' && activeModal !== null ? 'paused' : phase;
    engineRef.current?.setPhase(enginePhase);
  }, [phase, activeModal]);

  // Sync audio mood when world mood changes
  useEffect(() => {
    audioRef.current?.setMood(world.mood);
  }, [world.mood]);

  const startGameplay = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new AdaptiveAudioEngine();
    }
    audioRef.current.start();
    audioRef.current.setMood(worldRef.current.mood);
    setActiveModal(null);
    setPhase('playing');
  }, []);

  const openShrineQuest = useCallback((shrineId: string) => {
    const store = memoryStoreRef.current;
    const shrine = simRef.current.shrines.find((s) => s.id === shrineId);
    if (shrine && !worldRef.current.discoveredShrines.includes(shrineId)) {
      store.addMemory({
        summary: `Approached ${shrine.name} in ${worldRef.current.realmName}, sensing deep meridian resonance.`,
        category: 'discovery',
        factionTag: shrine.faction,
        importance: 7,
      });
      store.saveToBrowser();
      setMemoryVersion((v) => v + 1);
    }

    const nextQuest = generateEmergentQuest({
      world: worldRef.current,
      player: simRef.current.player,
      shrines: simRef.current.shrines,
      memoryStore: store,
      focusShrineId: shrineId,
    });
    setActiveQuest(nextQuest);
    setDeepQuestError(null);
    setActiveModal('quests');
  }, []);

  const handleTogglePause = useCallback(() => {
    if (activeModalRef.current !== null) {
      setActiveModal(null);
      return;
    }
    setPhase((prev) => {
      if (prev === 'playing') return 'paused';
      if (prev === 'paused') return 'playing';
      return prev;
    });
  }, []);

  const handleSimEvents = useCallback((events: SimEvent[]) => {
    const audio = audioRef.current;
    const store = memoryStoreRef.current;
    let recordedMem = false;

    for (const ev of events) {
      if (audio) {
        if (ev.type !== 'shard_pickup') {
          audio.playSfx(ev.type, ev.weight);
        }
      }
      if (ev.type === 'enemy_ko') {
        store.addMemory({
          summary: `Overcame a vigilant obsidian sentinel near (${Math.round(ev.x)}, ${Math.round(ev.z)}) in ${worldRef.current.realmName}.`,
          category: 'combat',
          factionTag: getDominantFaction(worldRef.current),
          importance: 6,
        });
        recordedMem = true;
      }
    }
    if (recordedMem) {
      store.saveToBrowser();
      setMemoryVersion((v) => v + 1);
    }
  }, []);

  // Mount ThreeWorldEngine ONCE in an isolated container
  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const engine = new ThreeWorldEngine(
      container,
      simRef.current,
      worldRef.current.biomeKey,
      {
        onHudUpdate: (snapshot) => {
          setHud({
            ...snapshot,
            stability: worldRef.current.stability,
          });
          audioRef.current?.setThreat(snapshot.activeEnemyThreat);
        },
        onSimEvents: handleSimEvents,
        onPlayerDefeated: () => {
          setActiveModal(null);
          setPhase('gameover');
        },
        onInteractNearestShrine: (shrineId) => {
          openShrineQuest(shrineId);
        },
        onTogglePause: handleTogglePause,
      }
    );
    engineRef.current = engine;

    // Support ?autostart=1 for automated testing and direct entry
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      setPhase('playing');
      engine.setPhase('playing');
    }

    return () => {
      engine.dispose();
      engineRef.current = null;
      audioRef.current?.dispose();
      audioRef.current = null;
    };
  }, [handleSimEvents, handleTogglePause, openShrineQuest]);

  // Global keyboard shortcuts (Title Enter/Space + Gameplay Q/G/M/V/C)
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

      if (phaseRef.current !== 'playing') return;

      if (e.code === 'KeyQ') {
        e.preventDefault();
        setActiveModal((m) => (m === 'quests' ? null : 'quests'));
      } else if (e.code === 'KeyG') {
        e.preventDefault();
        setActiveModal((m) => (m === 'atlas' ? null : 'atlas'));
      } else if (e.code === 'KeyM') {
        e.preventDefault();
        setActiveModal((m) => (m === 'soundscape' ? null : 'soundscape'));
      } else if (e.code === 'KeyV') {
        e.preventDefault();
        setActiveModal((m) => (m === 'voice' ? null : 'voice'));
      } else if (e.code === 'KeyC') {
        e.preventDefault();
        setActiveModal((m) => (m === 'cloud' ? null : 'cloud'));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [startGameplay]);

  // Firebase Auth listener
  useEffect(() => {
    if (!isFirebaseReady() || !auth) return;
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      if (nextUser && nextUser.emailVerified) {
        void ensureUserProfile(nextUser).catch(() => {
          // Handled via ErrorBoundary or explicit sync feedback
        });
      }
    });
    return () => unsub();
  }, []);

  // Cross-platform Multiplayer subscription & throttled presence broadcast (only when signed in & playing)
  useEffect(() => {
    if (!user || !user.emailVerified || phase !== 'playing') {
      setRemotePlayers([]);
      setBeacons([]);
      engineRef.current?.updateRemotePlayers([]);
      engineRef.current?.updateBeacons([]);
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
          (players) => {
            setRemotePlayers(players);
            engineRef.current?.updateRemotePlayers(players);
          },
          (nextBeacons) => {
            setBeacons(nextBeacons);
            engineRef.current?.updateBeacons(nextBeacons);
          }
        );

        await publishPlayerPresence(user, realmId, simRef.current.player, worldRef.current);
        presenceTimer = window.setInterval(() => {
          if (phaseRef.current === 'playing') {
            void publishPlayerPresence(
              user,
              realmId,
              simRef.current.player,
              worldRef.current
            ).catch(() => {});
          }
        }, 1600);
      } catch {
        // Offline or rules restriction; local gameplay continues uninterrupted
      }
    })();

    return () => {
      active = false;
      if (presenceTimer !== null) window.clearInterval(presenceTimer);
      unsub?.();
      void removePlayerPresence(user, realmId);
    };
  }, [user, phase, world.realmId]);

  // Quest choice resolution with narrative, world, audio, and vector DB consequences
  const handleSelectQuestChoice = (choiceId: string) => {
    if (!activeQuest || activeQuest.status !== 'active') return;
    const store = memoryStoreRef.current;

    const result = resolveQuestChoice({
      quest: activeQuest,
      choiceId,
      world,
      player: simRef.current.player,
      memoryStore: store,
    });

    // Apply player rewards & optional sentinel wave
    const p = simRef.current.player;
    p.shards += result.playerRewards.shardReward;
    p.hp = Math.min(p.maxHp, p.hp + result.playerRewards.healAmount);
    p.xp += 45;
    if (p.xp >= p.level * 100) {
      p.xp -= p.level * 100;
      p.level += 1;
      p.maxHp += 10;
      p.hp = p.maxHp;
    }

    // Mark target shrine attuned
    const targetShrine = simRef.current.shrines.find((s) => s.id === activeQuest.shrineId);
    if (targetShrine) targetShrine.attuned = true;

    if (result.playerRewards.spawnSentinelWave) {
      spawnDifficultyWave(simRef.current);
    }

    audioRef.current?.playSfx('quest_complete', 0.8);
    setActiveQuest(result.updatedQuest);
    setWorld(result.updatedWorld);
    setMemoryVersion((v) => v + 1);
    setHud((prev) => ({
      ...prev,
      hp: Math.round(p.hp),
      maxHp: Math.round(p.maxHp),
      shards: Math.round(p.shards),
      level: p.level,
      stability: result.updatedWorld.stability,
    }));

    // Trigger Victory milestone modal on the 3rd completed quest
    if (result.updatedWorld.completedQuests === 3) {
      window.setTimeout(() => {
        setActiveModal(null);
        setPhase('victory');
      }, 900);
    }
  };

  const handleWeaveLocalQuest = () => {
    setDeepQuestError(null);
    const q = generateEmergentQuest({
      world,
      player: simRef.current.player,
      shrines: simRef.current.shrines,
      memoryStore: memoryStoreRef.current,
    });
    setActiveQuest(q);
  };

  const handleSynthesizeDeepQuest = async () => {
    setDeepQuestBusy(true);
    setDeepQuestError(null);
    try {
      const store = memoryStoreRef.current;
      const shrine =
        simRef.current.shrines.find((s) => !s.attuned) || simRef.current.shrines[0];
      const memories = store.query(
        `${getDominantFaction(world)} ${world.biomeKey} ${shrine.name}`,
        4
      );
      const contextText = buildQuestSynthesisContext({
        world,
        player: simRef.current.player,
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
        throw new Error(data.error || 'Unable to synthesize Gemini 4 Carbon quest.');
      }
      setActiveQuest(data.quest);
    } catch (err) {
      setDeepQuestError(
        err instanceof Error ? err.message : 'Deep quest synthesis failed.'
      );
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

  // World Atlas real-world coordinate biome attunement
  const handleAttuneCoordinates = (lat: number, lng: number) => {
    const derived = deriveBiomeFromCoords(lat, lng);
    const palette = BIOME_PALETTES[derived.biomeKey];

    const updatedWorld: WorldState = {
      ...world,
      lat,
      lng,
      biomeKey: derived.biomeKey,
      realmId: derived.realmId,
      realmName: derived.realmName,
    };
    setWorld(updatedWorld);
    engineRef.current?.applyBiome(derived.biomeKey, palette.seedOffset);

    const store = memoryStoreRef.current;
    store.addMemory({
      summary: `Attuned the Living Atlas to (${lat.toFixed(2)}, ${lng.toFixed(2)}), shifting the sanctuary into ${palette.name}.`,
      category: 'atlas',
      factionTag: getDominantFaction(updatedWorld),
      importance: 8,
    });
    store.saveToBrowser();
    setMemoryVersion((v) => v + 1);
    setHud((prev) => ({ ...prev, biomeName: palette.name }));
  };

  // Restart / New Realm cleanly resets simulation & player position
  const handleRestart = () => {
    const freshWorld = createInitialWorldState();
    const freshSim = createInitialSimulation(BIOME_PALETTES[freshWorld.biomeKey].seedOffset);
    simRef.current = freshSim;
    engineRef.current?.setSimulation(freshSim);
    engineRef.current?.applyBiome(freshWorld.biomeKey, freshSim.seedOffset);
    setWorld(freshWorld);
    setHud(createInitialHud(BIOME_PALETTES[freshWorld.biomeKey].name));
    setActiveQuest(
      generateEmergentQuest({
        world: freshWorld,
        player: freshSim.player,
        shrines: freshSim.shrines,
        memoryStore: memoryStoreRef.current,
      })
    );
    setActiveModal(null);
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
      setSyncMessage('Signed in with Google. Cloud sync and multiplayer unlocked.');
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Google sign-in was cancelled or blocked.';
      setAuthError(msg);
      setSyncError(msg);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    await signOutPlayer();
    setUser(null);
    setSyncMessage('Signed out. Continuing in local on-device mode.');
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
        simRef.current.player,
        memoryStoreRef.current
      );
      setSyncMessage(
        `Cloud save updated (${world.realmName}) and ${memoriesUploaded} new vector memories synchronized.`
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
      const { save, memoriesMerged } = await restoreCloudSave(
        user,
        memoryStoreRef.current
      );
      if (save) {
        const palette = BIOME_PALETTES[save.biomeKey] ?? BIOME_PALETTES.highland_dusk;
        const restoredWorld: WorldState = {
          ...world,
          realmId: save.realmId,
          realmName: save.slotLabel,
          biomeKey: palette.key,
          lat: save.lat,
          lng: save.lng,
          stability: save.stability,
          orderRep: save.orderRep,
          verdantRep: save.verdantRep,
          unboundRep: save.unboundRep,
          completedQuests: save.completedQuests,
        };
        setWorld(restoredWorld);
        engineRef.current?.applyBiome(palette.key, palette.seedOffset);

        const p = simRef.current.player;
        p.x = save.playerX;
        p.z = save.playerZ;
        p.y = groundHeightAt(save.playerX, save.playerZ, palette.seedOffset);
        p.hp = Math.max(10, save.hp);
        p.maxHp = Math.max(100, save.maxHp);
        p.shards = save.shards;
        p.level = save.level;
        setMemoryVersion((v) => v + 1);
        setSyncMessage(
          `Restored cloud progression (${save.slotLabel}) and merged ${memoriesMerged} vector memories.`
        );
      } else {
        setSyncMessage(
          memoriesMerged > 0
            ? `Merged ${memoriesMerged} vector memories from cloud.`
            : 'No previous cloud save found for this account yet.'
        );
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
        simRef.current.player.x,
        simRef.current.player.z,
        getDominantFaction(world)
      );
      setSyncMessage('Shared narrative beacon planted in this realm.');
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Could not plant beacon.');
    }
  };

  const voiceContextSummary = useMemo(() => {
    void memoryVersion;
    const topMem = memoryStoreRef.current.getAll()[0]?.summary ?? 'Arrived in Aethern.';
    return `Realm: ${world.realmName}. Stability: ${Math.round(world.stability)}%. Order:${world.orderRep} Verdant:${world.verdantRep} Unbound:${world.unboundRep}. Latest memory: ${topMem}`;
  }, [world, memoryVersion]);

  const memoryCount = useMemo(() => {
    void memoryVersion;
    return memoryStoreRef.current.count();
  }, [memoryVersion]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#101520] text-[#f3ece0]">
      {/* Google Maps Platform Demo Key Quota Banner (Tier 2) */}
      {gmpQuotaExceeded && (
        <div
          role="alert"
          className="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center justify-between gap-2 border-b border-amber-400/60 bg-amber-950/95 px-4 py-2 text-xs text-amber-100"
        >
          <span>
            Google Maps demo key quota reached. Switch to your own Cloud API key to continue using
            the interactive World Atlas map.{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noreferrer"
              className="font-semibold underline hover:text-amber-300"
            >
              Learn how to resolve quota errors
            </a>
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

      {/* Isolated 3D WebGL Canvas Mount */}
      <div
        ref={canvasMountRef}
        data-testid="game-canvas-container"
        className="fixed inset-0 h-full w-full"
      />

      {/* Title Screen Overlay */}
      {phase === 'title' && (
        <TitleOverlay
          realmName={world.realmName}
          user={user}
          authBusy={authBusy}
          authError={authError}
          memoryCount={memoryCount}
          onStart={startGameplay}
          onSignIn={handleGoogleSignIn}
        />
      )}

      {/* Live Gameplay HUD */}
      {phase === 'playing' && (
        <GameHud
          hud={hud}
          world={world}
          activeQuest={activeQuest}
          remotePlayerCount={remotePlayers.length}
          isMuted={isMuted}
          onOpenQuests={() => setActiveModal('quests')}
          onOpenSoundscape={() => setActiveModal('soundscape')}
          onOpenVoiceOracle={() => setActiveModal('voice')}
          onOpenWorldAtlas={() => setActiveModal('atlas')}
          onOpenCloud={() => setActiveModal('cloud')}
          onTogglePause={handleTogglePause}
          onInteractShrine={openShrineQuest}
        />
      )}

      {/* Mobile & Touch Controls */}
      {phase === 'playing' && activeModal === null && (
        <MobileTouchControls
          visible={showTouchControls}
          canInteract={Boolean(hud.nearestShrine && hud.nearestShrine.distance <= 8.5)}
          onJoystickMove={(x, z) => engineRef.current?.setTouchJoystick(x, z)}
          onAction={(action) => engineRef.current?.triggerTouchAction(action)}
        />
      )}

      {/* Dynamic Quest & Local Vector Memory Drawer */}
      <QuestMemoryDrawer
        open={activeModal === 'quests'}
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

      {/* Adaptive Soundscape & Lyria Composer */}
      <SoundscapePanel
        open={activeModal === 'soundscape'}
        mood={world.mood}
        threat={hud.activeEnemyThreat}
        biomeName={hud.biomeName}
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

      {/* Real-Time Gemini 3.8 Live Voice Oracle */}
      <VoiceOracleModal
        open={activeModal === 'voice'}
        worldContext={voiceContextSummary}
        onClose={() => setActiveModal(null)}
        onSetAudioDucked={(ducked) => audioRef.current?.setDucked(ducked)}
      />

      {/* Google Maps Platform World Atlas */}
      <WorldAtlasModal
        open={activeModal === 'atlas'}
        world={world}
        onClose={() => setActiveModal(null)}
        onAttuneCoordinates={handleAttuneCoordinates}
      />

      {/* Firebase Auth, Cloud Sync & Cross-Platform Multiplayer */}
      <CloudMultiplayerModal
        open={activeModal === 'cloud'}
        user={user}
        world={world}
        remotePlayers={remotePlayers}
        beacons={beacons}
        syncBusy={syncBusy}
        syncMessage={syncMessage}
        syncError={syncError}
        showTouchControls={showTouchControls}
        onClose={() => setActiveModal(null)}
        onSignIn={handleGoogleSignIn}
        onSignOut={handleSignOut}
        onUploadSave={handleUploadCloudSave}
        onRestoreSave={handleRestoreCloudSave}
        onPlantBeacon={handlePlantBeacon}
        onToggleTouchControls={() => setTouchOverride(!showTouchControls)}
      />

      {/* Paused / Victory / Game Over Modal */}
      <StatusModal
        phase={phase}
        hud={hud}
        world={world}
        memoryCount={memoryCount}
        onResume={() => setPhase('playing')}
        onRestart={handleRestart}
        onReturnTitle={() => {
          setActiveModal(null);
          setPhase('title');
        }}
      />
    </div>
  );
}
