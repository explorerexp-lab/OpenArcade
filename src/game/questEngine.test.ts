import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveBiomeFromCoords,
  generateEmergentQuest,
  resolveQuestChoice,
} from './questEngine';
import { createInitialSimulation } from './simulation';
import { VectorMemoryStore } from './vectorMemory';
import type { WorldState } from './types';

function createTestWorld(): WorldState {
  return {
    realmId: 'sanctuary-prime',
    realmName: 'Sunlit Highland Observatory',
    biomeKey: 'highland_dusk',
    lat: 35.6762,
    lng: 139.6503,
    stability: 72,
    orderRep: 10,
    verdantRep: 5,
    unboundRep: 0,
    completedQuests: 0,
    discoveredShrines: [],
    mood: 'wonder',
  };
}

test('deriveBiomeFromCoords deterministically maps real-world lat/lng to distinct biomes', () => {
  assert.equal(deriveBiomeFromCoords(64.1466, -21.9426).biomeKey, 'obsidian_borealis');
  assert.equal(deriveBiomeFromCoords(25.2048, 55.2708).biomeKey, 'sahara_amber');
  assert.equal(deriveBiomeFromCoords(35.6762, 139.6503).biomeKey, 'pacific_jade');
  assert.equal(deriveBiomeFromCoords(46.5197, 6.6323).biomeKey, 'highland_dusk');
});

test('generateEmergentQuest retrieves vector memory and resolveQuestChoice mutates state + stores memory', () => {
  const store = new VectorMemoryStore();
  const sim = createInitialSimulation(1.0);
  const world = createTestWorld();

  const quest = generateEmergentQuest({
    world,
    player: sim.player,
    shrines: sim.shrines,
    memoryStore: store,
  });

  assert.equal(quest.status, 'active');
  assert.equal(quest.choices.length, 3);
  assert.ok(quest.memoryAnchor.length > 10);

  const countBefore = store.count();
  const unboundChoice = quest.choices.find((c) => c.stance === 'unbound');
  assert.ok(unboundChoice);

  const resolved = resolveQuestChoice({
    quest,
    choiceId: unboundChoice.id,
    world,
    player: sim.player,
    memoryStore: store,
  });

  assert.equal(resolved.updatedQuest.status, 'resolved');
  assert.equal(resolved.updatedWorld.completedQuests, 1);
  assert.ok(resolved.updatedWorld.unboundRep > world.unboundRep);
  assert.ok(resolved.updatedWorld.stability < world.stability);
  assert.equal(store.count(), countBefore + 1);
});
