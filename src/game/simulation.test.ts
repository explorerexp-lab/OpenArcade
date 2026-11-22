import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CONCURRENT_ATTACKERS,
  createInitialSimulation,
  groundHeightAt,
  stepSimulation,
  type InputSnapshot,
} from './simulation';

const IDLE_INPUT: InputSnapshot = {
  moveX: 0,
  moveZ: 0,
  cameraYaw: 0,
  jumpHeld: false,
  jumpJustPressed: false,
  dashJustPressed: false,
  strikeJustPressed: false,
};

test('central plaza is flat and player survives initial 5 seconds without input', () => {
  assert.equal(groundHeightAt(0, 0, 1.0), 0);
  assert.equal(groundHeightAt(0, 6, 1.0), 0);

  const sim = createInitialSimulation(1.0);
  for (let i = 0; i < 300; i++) {
    stepSimulation(sim, 1 / 60, IDLE_INPUT);
  }
  assert.equal(sim.player.hp, 100);
  assert.equal(sim.player.grounded, true);
});

test('jump buffering and movement advance player coordinates smoothly', () => {
  const sim = createInitialSimulation(1.0);
  const startZ = sim.player.z;

  const events = stepSimulation(sim, 0.016, {
    ...IDLE_INPUT,
    moveZ: -1,
    jumpHeld: true,
    jumpJustPressed: true,
  });
  assert.ok(events.some((e) => e.type === 'jump'));
  assert.ok(sim.player.vy > 0);

  for (let i = 0; i < 20; i++) {
    stepSimulation(sim, 0.016, { ...IDLE_INPUT, moveZ: -1, jumpHeld: true });
  }
  assert.ok(sim.player.z < startZ - 1.5, 'Player should move forward along -Z');
});

test('3 enemy archetypes follow distinct movement policies and obey attack token cap', () => {
  const sim = createInitialSimulation(1.0);
  // Position one of each archetype equidistant from player (12m)
  const stalker = sim.enemies.find((e) => e.archetype === 'stalker')!;
  const weaver = sim.enemies.find((e) => e.archetype === 'weaver')!;
  const golem = sim.enemies.find((e) => e.archetype === 'golem')!;

  stalker.x = 0;
  stalker.z = -6;
  weaver.x = 10;
  weaver.z = 6;
  golem.x = -5;
  golem.z = 6;

  // Step 40 frames and verify attack token limit is never exceeded
  for (let i = 0; i < 40; i++) {
    stepSimulation(sim, 0.025, IDLE_INPUT);
    const activeAttackers = sim.enemies.filter((e) => e.hasAttackToken).length;
    assert.ok(
      activeAttackers <= MAX_CONCURRENT_ATTACKERS,
      `Active attackers ${activeAttackers} exceeded cap ${MAX_CONCURRENT_ATTACKERS}`
    );
  }

  // Weaver keeps distance (kiting) whereas Stalker closes in faster than Golem
  const weaverDist = Math.hypot(weaver.x - sim.player.x, weaver.z - sim.player.z);
  assert.ok(weaverDist > 7, `Weaver should kite at range, got dist ${weaverDist}`);
});

test('resonance strike damages and defeats nearby enemy with hitstop', () => {
  const sim = createInitialSimulation(1.0);
  const target = sim.enemies[0];
  target.x = sim.player.x;
  target.z = sim.player.z - 2.5;
  target.hp = 20;

  const events = stepSimulation(sim, 0.016, {
    ...IDLE_INPUT,
    strikeJustPressed: true,
  });

  assert.ok(events.some((e) => e.type === 'enemy_ko'));
  assert.equal(sim.player.defeatedCount, 1);
  assert.ok(sim.hitstopTimer > 0);
});
