import type {
  BiomeKey,
  BiomePalette,
  DynamicQuest,
  FactionId,
  PlayerSimState,
  QuestChoice,
  RetrievedMemory,
  ShrineNode,
  WorldState,
} from './types';
import type { VectorMemoryStore } from './vectorMemory';

export const BIOME_PALETTES: Record<BiomeKey, BiomePalette> = {
  highland_dusk: {
    key: 'highland_dusk',
    name: 'Sunlit Highland Observatory',
    skyTop: 0x1d2b44,
    skyHorizon: 0xd9a16c,
    fogColor: 0xc99c72,
    fogDensity: 0.0115,
    keyLightColor: 0xffd29d,
    keyLightIntensity: 2.3,
    hemiSkyColor: 0x7aa0cc,
    hemiGroundColor: 0x4b3f35,
    terrainPrimary: '#5d6b4c',
    terrainSecondary: '#86785e',
    stoneTint: 0x9c9484,
    accentHex: '#e5a94c',
    accentColor: 0xe5a94c,
    foliageBase: 0x3f5e43,
    waterColor: 0x2f5f6b,
    seedOffset: 1.0,
  },
  sahara_amber: {
    key: 'sahara_amber',
    name: 'Red Sandstone Meridian',
    skyTop: 0x2b2438,
    skyHorizon: 0xe0955a,
    fogColor: 0xd48e58,
    fogDensity: 0.0125,
    keyLightColor: 0xffc482,
    keyLightIntensity: 2.5,
    hemiSkyColor: 0x9ab0cf,
    hemiGroundColor: 0x6e472c,
    terrainPrimary: '#a9774d',
    terrainSecondary: '#c49768',
    stoneTint: 0xb88f6d,
    accentHex: '#f29f3d',
    accentColor: 0xf29f3d,
    foliageBase: 0x5c6b3d,
    waterColor: 0x35696e,
    seedOffset: 7.3,
  },
  pacific_jade: {
    key: 'pacific_jade',
    name: 'Misty Jade Caldera',
    skyTop: 0x17313d,
    skyHorizon: 0x93b8b2,
    fogColor: 0x8db2ac,
    fogDensity: 0.012,
    keyLightColor: 0xffe5bd,
    keyLightIntensity: 2.1,
    hemiSkyColor: 0x8bc5c9,
    hemiGroundColor: 0x33473c,
    terrainPrimary: '#446a52',
    terrainSecondary: '#697a63',
    stoneTint: 0x7c8a84,
    accentHex: '#4fd1a5',
    accentColor: 0x4fd1a5,
    foliageBase: 0x2e5942,
    waterColor: 0x236a73,
    seedOffset: 13.7,
  },
  obsidian_borealis: {
    key: 'obsidian_borealis',
    name: 'Basalt Aurora Citadel',
    skyTop: 0x101829,
    skyHorizon: 0x496d78,
    fogColor: 0x3b5866,
    fogDensity: 0.013,
    keyLightColor: 0xb8e6ff,
    keyLightIntensity: 2.0,
    hemiSkyColor: 0x63b5c4,
    hemiGroundColor: 0x252836,
    terrainPrimary: '#414c54',
    terrainSecondary: '#58626b',
    stoneTint: 0x636c78,
    accentHex: '#5ec9e8',
    accentColor: 0x5ec9e8,
    foliageBase: 0x2b494f,
    waterColor: 0x1d4354,
    seedOffset: 23.1,
  },
};

export function deriveBiomeFromCoords(lat: number, lng: number): {
  biomeKey: BiomeKey;
  realmId: string;
  realmName: string;
} {
  const absLat = Math.abs(lat);
  let biomeKey: BiomeKey;
  if (absLat >= 55) {
    biomeKey = 'obsidian_borealis';
  } else if (absLat <= 28 && lng >= -25 && lng <= 65) {
    biomeKey = 'sahara_amber';
  } else if (lng > 95 || lng < -105) {
    biomeKey = 'pacific_jade';
  } else {
    biomeKey = 'highland_dusk';
  }

  const latTag = `${lat >= 0 ? 'N' : 'S'}${Math.round(Math.abs(lat))}`;
  const lngTag = `${lng >= 0 ? 'E' : 'W'}${Math.round(Math.abs(lng))}`;
  const realmId = `atlas-${latTag}-${lngTag}-${biomeKey.split('_')[0]}`.toLowerCase();
  const realmName = `${BIOME_PALETTES[biomeKey].name} (${latTag} ${lngTag})`;

  return { biomeKey, realmId, realmName };
}

export function getDominantFaction(world: WorldState): FactionId {
  const scores: Array<[FactionId, number]> = [
    ['order', world.orderRep],
    ['verdant', world.verdantRep],
    ['unbound', world.unboundRep],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  if (scores[0][1] <= 0) return 'neutral';
  return scores[0][0];
}

interface QuestTemplate {
  idPrefix: string;
  title: string;
  premiseBuilder: (mem: string, world: WorldState, player: PlayerSimState) => string;
  choices: (shrine: ShrineNode, world: WorldState) => QuestChoice[];
}

const QUEST_TEMPLATES: QuestTemplate[] = [
  {
    idPrefix: 'astrolabe-fracture',
    title: 'The Fractured Meridian',
    premiseBuilder: (mem, world, player) =>
      `The bronze rings above ${world.realmName} have drifted out of alignment (Stability ${Math.round(world.stability)}%). Your chronicle recalls: "${mem}" With ${player.shards} shards in hand, the shrine awaits your decree.`,
    choices: (shrine) => [
      {
        id: 'calibrate-order',
        label: 'Lock the Brass Rings into Law',
        stance: 'order',
        consequencePreview: '+18 Order · +12 Stability · Calms sentinels',
        narrativeOutcome: `You anchor ${shrine.name} in precise clockwork cadence. A warm amber resonance steadies the highland horizon.`,
        effects: {
          orderDelta: 18,
          verdantDelta: -6,
          unboundDelta: -6,
          stabilityDelta: 12,
          shardReward: 25,
          healAmount: 20,
          moodShift: 'wonder',
        },
        memoryImprint: `Anchored ${shrine.name} under Order of the Astrolabe clockwork law, stabilizing the meridian.`,
      },
      {
        id: 'overgrow-verdant',
        label: 'Unseal the Living Cypress Roots',
        stance: 'verdant',
        consequencePreview: '+18 Verdant · +35 HP · Restores sanctuary flora',
        narrativeOutcome: `Luminous roots surge through ${shrine.name}'s stonework, mending your vitality while loosening the Order's rigid wards.`,
        effects: {
          orderDelta: -8,
          verdantDelta: 18,
          unboundDelta: 4,
          stabilityDelta: 6,
          shardReward: 20,
          healAmount: 35,
          moodShift: 'mystery',
        },
        memoryImprint: `Unsealed living cypress roots at ${shrine.name}, favoring Verdant Echoes growth over brass order.`,
      },
      {
        id: 'shatter-unbound',
        label: 'Shatter the Containment Core',
        stance: 'unbound',
        consequencePreview: '+22 Unbound · +45 Shards · -14 Stability · Awakens Wardens',
        narrativeOutcome: `Raw aether erupts from ${shrine.name}, showering you in high-yield shards while drawing alert obsidian sentinels across the ridge.`,
        effects: {
          orderDelta: -14,
          verdantDelta: -4,
          unboundDelta: 22,
          stabilityDelta: -14,
          shardReward: 45,
          healAmount: 0,
          moodShift: 'tension',
          spawnSentinelWave: true,
        },
        memoryImprint: `Shattered the containment core at ${shrine.name} for the Unbound Seekers, unleashing wild shard storms.`,
      },
    ],
  },
  {
    idPrefix: 'sentinel-reckoning',
    title: 'Echoes of the Broken Watch',
    premiseBuilder: (mem, world, player) =>
      `Having overcome ${player.defeatedCount} constructs, a dormant memory resonates inside the monolith: "${mem}" The constructs are not mindless—they mirror whoever holds sway over ${world.realmName}.`,
    choices: (shrine) => [
      {
        id: 'rebind-watch',
        label: 'Reprogram the Watch Protocol',
        stance: 'order',
        consequencePreview: '+20 Order · +10 Stability · +30 Shards',
        narrativeOutcome: `You inscribe clean telemetry runes into ${shrine.name}, binding nearby patrol rhythms into harmonic predictability.`,
        effects: {
          orderDelta: 20,
          verdantDelta: -4,
          unboundDelta: -8,
          stabilityDelta: 10,
          shardReward: 30,
          healAmount: 15,
          moodShift: 'triumph',
        },
        memoryImprint: `Rebound the ancient sentinel watch at ${shrine.name} into Order protocol with disciplined precision.`,
      },
      {
        id: 'commune-echo',
        label: 'Release Their Trapped Memories',
        stance: 'verdant',
        consequencePreview: '+20 Verdant · +30 HP · +4 Stability',
        narrativeOutcome: `Soft choral harmonics drift across the valley as old construct husks dissolve into glowing pollen, restoring your strength.`,
        effects: {
          orderDelta: -6,
          verdantDelta: 20,
          unboundDelta: 6,
          stabilityDelta: 4,
          shardReward: 22,
          healAmount: 30,
          moodShift: 'melancholy',
        },
        memoryImprint: `Showed mercy at ${shrine.name} and released the trapped memories of fallen sentinels into the Verdant canopy.`,
      },
      {
        id: 'harvest-cores',
        label: 'Overclock Their Obsidian Cores',
        stance: 'unbound',
        consequencePreview: '+24 Unbound · +55 Shards · -12 Stability · Heavy Patrol',
        narrativeOutcome: `You siphon volatile resonance straight from the watch array, surging with shard energy as an alerted golem marches forth.`,
        effects: {
          orderDelta: -12,
          verdantDelta: -10,
          unboundDelta: 24,
          stabilityDelta: -12,
          shardReward: 55,
          healAmount: 0,
          moodShift: 'tension',
          spawnSentinelWave: true,
        },
        memoryImprint: `Harvested volatile obsidian cores at ${shrine.name}, defying both Order and Verdant guardians.`,
      },
    ],
  },
  {
    idPrefix: 'atlas-convergence',
    title: 'Convergence of the Living Atlas',
    premiseBuilder: (mem, world) =>
      `Real-world coordinates (${world.lat.toFixed(2)}, ${world.lng.toFixed(2)}) hum beneath the stone steps. The Vector Archive surfaces a decisive thread: "${mem}" Choose how this meridian shapes the realm's future.`,
    choices: (shrine) => [
      {
        id: 'chart-citadel',
        label: 'Chart a Permanent Observatory Beacon',
        stance: 'order',
        consequencePreview: '+16 Order · +14 Stability · +28 Shards',
        narrativeOutcome: `Golden latitude arcs flare across the sky above ${shrine.name}, locking the realm into a serene, charted sanctuary.`,
        effects: {
          orderDelta: 16,
          verdantDelta: 2,
          unboundDelta: -10,
          stabilityDelta: 14,
          shardReward: 28,
          healAmount: 20,
          moodShift: 'wonder',
        },
        memoryImprint: `Charted a permanent Order beacon at ${shrine.name}, aligning the Living Atlas to calm equilibrium.`,
      },
      {
        id: 'seed-grove',
        label: 'Transplant a Memory Grove',
        stance: 'verdant',
        consequencePreview: '+22 Verdant · +25 HP · +8 Stability',
        narrativeOutcome: `Bioluminescent spores drift from ${shrine.name} to the outer cliffs, weaving past choices into living timber.`,
        effects: {
          orderDelta: -4,
          verdantDelta: 22,
          unboundDelta: 2,
          stabilityDelta: 8,
          shardReward: 24,
          healAmount: 25,
          moodShift: 'mystery',
        },
        memoryImprint: `Planted a Verdant memory grove beside ${shrine.name} to preserve the realm's living history.`,
      },
      {
        id: 'open-rift',
        label: 'Open an Uncharted Rift Current',
        stance: 'unbound',
        consequencePreview: '+22 Unbound · +50 Shards · -10 Stability · Surge Threat',
        narrativeOutcome: `A crackling cobalt gust whips across the basin, forging rare shards from the storm while waking fierce sentinels.`,
        effects: {
          orderDelta: -10,
          verdantDelta: -6,
          unboundDelta: 22,
          stabilityDelta: -10,
          shardReward: 50,
          healAmount: 10,
          moodShift: 'tension',
          spawnSentinelWave: true,
        },
        memoryImprint: `Opened an Unbound rift current at ${shrine.name}, trading realm stability for uncharted power.`,
      },
    ],
  },
];

/**
 * Generates an emergent, contextually aware quest strictly on-device by querying the local
 * VectorMemoryStore against the player's current world state, dominant faction, and nearest shrine.
 */
export function generateEmergentQuest(params: {
  world: WorldState;
  player: PlayerSimState;
  shrines: ShrineNode[];
  memoryStore: VectorMemoryStore;
  focusShrineId?: string;
}): DynamicQuest {
  const { world, player, shrines, memoryStore, focusShrineId } = params;
  const dominant = getDominantFaction(world);

  const targetShrine =
    shrines.find((s) => s.id === focusShrineId) ||
    shrines.find((s) => !s.attuned) ||
    shrines[world.completedQuests % shrines.length];

  const queryContext = `${dominant} ${world.biomeKey} ${targetShrine.name} ${
    world.stability < 45 ? 'storm fracture combat sentinel' : 'shrine astrolabe relic growth'
  } ${player.defeatedCount > 0 ? 'combat sentinel' : 'discovery'}`;

  const recalled: RetrievedMemory[] = memoryStore.query(queryContext, 3);
  const topMemory =
    recalled[0]?.entry.summary ??
    'The highland monoliths await your first imprint on the Living Atlas.';

  // Pick template dynamically based on player combat progress, stability, and completed quests
  let templateIndex = world.completedQuests % QUEST_TEMPLATES.length;
  if (player.defeatedCount >= 2 && world.completedQuests % 3 === 1) {
    templateIndex = 1;
  } else if (world.stability < 45) {
    templateIndex = 0;
  }
  const tpl = QUEST_TEMPLATES[templateIndex];

  return {
    id: `${tpl.idPrefix}-${Date.now()}`,
    title: tpl.title,
    shrineId: targetShrine.id,
    shrineName: targetShrine.name,
    premise: tpl.premiseBuilder(topMemory, world, player),
    memoryAnchor: topMemory,
    source: 'local-vector',
    status: 'active',
    choices: tpl.choices(targetShrine, world),
    createdAt: Date.now(),
  };
}

/**
 * Applies a player's branching quest choice, mutating world state, player stats,
 * soundscape mood, and recording a permanent high-importance episodic entry in the Vector DB.
 */
export function resolveQuestChoice(params: {
  quest: DynamicQuest;
  choiceId: string;
  world: WorldState;
  player: PlayerSimState;
  memoryStore: VectorMemoryStore;
}): {
  updatedQuest: DynamicQuest;
  updatedWorld: WorldState;
  playerRewards: {
    shardReward: number;
    healAmount: number;
    spawnSentinelWave: boolean;
  };
  newMemorySummary: string;
} {
  const { quest, choiceId, world, memoryStore } = params;
  const choice = quest.choices.find((c) => c.id === choiceId);
  if (!choice) {
    throw new Error(`Choice ${choiceId} not found in quest ${quest.id}`);
  }

  const updatedWorld: WorldState = {
    ...world,
    orderRep: world.orderRep + choice.effects.orderDelta,
    verdantRep: world.verdantRep + choice.effects.verdantDelta,
    unboundRep: world.unboundRep + choice.effects.unboundDelta,
    stability: Math.max(5, Math.min(100, world.stability + choice.effects.stabilityDelta)),
    completedQuests: world.completedQuests + 1,
    discoveredShrines: world.discoveredShrines.includes(quest.shrineId)
      ? world.discoveredShrines
      : [...world.discoveredShrines, quest.shrineId],
    mood: choice.effects.moodShift,
  };

  memoryStore.addMemory({
    summary: choice.memoryImprint,
    category: 'choice',
    factionTag: choice.stance,
    importance: 9,
  });
  memoryStore.saveToBrowser();

  const updatedQuest: DynamicQuest = {
    ...quest,
    status: 'resolved',
    chosenId: choice.id,
    outcomeText: choice.narrativeOutcome,
  };

  return {
    updatedQuest,
    updatedWorld,
    playerRewards: {
      shardReward: choice.effects.shardReward,
      healAmount: choice.effects.healAmount,
      spawnSentinelWave: Boolean(choice.effects.spawnSentinelWave),
    },
    newMemorySummary: choice.memoryImprint,
  };
}

export function buildQuestSynthesisContext(params: {
  world: WorldState;
  player: PlayerSimState;
  shrine: ShrineNode;
  memories: RetrievedMemory[];
}): string {
  const memLines = params.memories
    .map((m, i) => `${i + 1}. [${m.entry.factionTag}, sim=${m.similarity.toFixed(2)}] ${m.entry.summary}`)
    .join('\n');

  return [
    `Realm: ${params.world.realmName} (Biome: ${params.world.biomeKey}, Coords: ${params.world.lat.toFixed(2)}, ${params.world.lng.toFixed(2)})`,
    `World Stability: ${Math.round(params.world.stability)}% | Completed Quests: ${params.world.completedQuests}`,
    `Faction Standing -> Order: ${params.world.orderRep}, Verdant: ${params.world.verdantRep}, Unbound: ${params.world.unboundRep}`,
    `Player -> Level ${params.player.level}, Shards ${params.player.shards}, Sentinels Defeated ${params.player.defeatedCount}`,
    `Active Shrine: ${params.shrine.name} (${params.shrine.faction})`,
    `Top-K Recalled Vector Memories:\n${memLines}`,
  ].join('\n');
}
