export type GamePhase = 'title' | 'playing' | 'paused' | 'victory' | 'gameover';

export type FactionId = 'order' | 'verdant' | 'unbound' | 'neutral';

export type BiomeKey =
  | 'highland_dusk'
  | 'sahara_amber'
  | 'pacific_jade'
  | 'obsidian_borealis';

export type MemoryCategory = 'choice' | 'combat' | 'discovery' | 'quest' | 'atlas';

export type SoundMood = 'wonder' | 'mystery' | 'tension' | 'melancholy' | 'triumph';

export interface BiomePalette {
  key: BiomeKey;
  name: string;
  skyTop: number;
  skyHorizon: number;
  fogColor: number;
  fogDensity: number;
  keyLightColor: number;
  keyLightIntensity: number;
  hemiSkyColor: number;
  hemiGroundColor: number;
  terrainPrimary: string;
  terrainSecondary: string;
  stoneTint: number;
  accentHex: string;
  accentColor: number;
  foliageBase: number;
  waterColor: number;
  seedOffset: number;
}

export interface VectorMemoryEntry {
  id: string;
  summary: string;
  category: MemoryCategory;
  factionTag: FactionId;
  importance: number; // 1..10
  embedding: number[]; // 64-dim L2-normalized vector
  createdAt: number;
  synced?: boolean;
}

export interface RetrievedMemory {
  entry: VectorMemoryEntry;
  similarity: number;
}

export interface QuestChoice {
  id: string;
  label: string;
  stance: FactionId;
  consequencePreview: string;
  narrativeOutcome: string;
  effects: {
    orderDelta: number;
    verdantDelta: number;
    unboundDelta: number;
    stabilityDelta: number;
    shardReward: number;
    healAmount: number;
    moodShift: SoundMood;
    spawnSentinelWave?: boolean;
  };
  memoryImprint: string;
}

export interface DynamicQuest {
  id: string;
  title: string;
  shrineId: string;
  shrineName: string;
  premise: string;
  memoryAnchor: string; // Cites recalled vector memory that shaped this quest
  source: 'local-vector' | 'gemini-carbon';
  status: 'active' | 'resolved';
  choices: QuestChoice[];
  chosenId?: string;
  outcomeText?: string;
  createdAt: number;
}

export interface WorldState {
  realmId: string;
  realmName: string;
  biomeKey: BiomeKey;
  lat: number;
  lng: number;
  stability: number; // 0..100
  orderRep: number;
  verdantRep: number;
  unboundRep: number;
  completedQuests: number;
  discoveredShrines: string[];
  mood: SoundMood;
}

export interface ShrineNode {
  id: string;
  name: string;
  x: number;
  z: number;
  faction: FactionId;
  attuned: boolean;
  color: number;
}

export type EnemyArchetype = 'stalker' | 'weaver' | 'golem';

export type EnemyBehaviorState =
  | 'patrol'
  | 'approach'
  | 'telegraph'
  | 'attack'
  | 'recover'
  | 'ko';

export interface EnemyEntity {
  id: string;
  archetype: EnemyArchetype;
  name: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  rotY: number;
  hp: number;
  maxHp: number;
  state: EnemyBehaviorState;
  stateTimer: number;
  attackCooldown: number;
  hitFlashTimer: number;
  koTimer: number;
  homeX: number;
  homeZ: number;
  orbitDir: number;
  hasAttackToken: boolean;
  telegraphX: number;
  telegraphZ: number;
}

export interface ProjectileEntity {
  id: string;
  fromPlayer: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  damage: number;
  color: number;
}

export interface PlayerSimState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rotY: number;
  hp: number;
  maxHp: number;
  resonance: number; // 0..100 energy for dash/strike
  shards: number;
  level: number;
  xp: number;
  grounded: boolean;
  coyoteTimer: number;
  jumpBufferTimer: number;
  dashTimer: number;
  dashCooldown: number;
  strikeTimer: number;
  strikeCooldown: number;
  invulnTimer: number;
  hitFlashTimer: number;
  walkDistance: number;
  squashY: number;
  defeatedCount: number;
}

export interface RemoteWayfarer {
  uid: string;
  callsign: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  faction: FactionId;
  shards: number;
  updatedAt: number;
}

export interface NarrativeBeacon {
  id: string;
  authorId: string;
  callsign: string;
  message: string;
  faction: FactionId;
  x: number;
  z: number;
  createdAt: number;
}

export interface HudSnapshot {
  hp: number;
  maxHp: number;
  resonance: number;
  shards: number;
  level: number;
  defeatedCount: number;
  stability: number;
  biomeName: string;
  nearestShrine: { id: string; name: string; distance: number } | null;
  activeEnemyThreat: number; // 0..1
  playerX: number;
  playerZ: number;
  dashReady: boolean;
  strikeReady: boolean;
}
