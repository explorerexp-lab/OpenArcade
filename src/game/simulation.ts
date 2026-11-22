import type {
  EnemyArchetype,
  EnemyEntity,
  PlayerSimState,
  ProjectileEntity,
  ShrineNode,
} from './types';

export const WORLD_PLAYABLE_RADIUS = 52;
export const GRAVITY = 26;
export const JUMP_VELOCITY = 10.6;
export const PLAYER_SPEED = 9.2;
export const DASH_SPEED = 21.5;
export const MAX_CONCURRENT_ATTACKERS = 2;

export interface InputSnapshot {
  moveX: number; // -1..1 (camera-relative right)
  moveZ: number; // -1..1 (camera-relative forward, -1 = forward)
  cameraYaw: number;
  jumpHeld: boolean;
  jumpJustPressed: boolean;
  dashJustPressed: boolean;
  strikeJustPressed: boolean;
}

export interface SimEvent {
  type:
    | 'jump'
    | 'land'
    | 'dash'
    | 'strike'
    | 'enemy_telegraph'
    | 'enemy_hit'
    | 'enemy_ko'
    | 'player_hurt'
    | 'shard_pickup';
  x: number;
  y: number;
  z: number;
  weight: number; // 0.3 light .. 1.0 heavy
}

export interface SimulationState {
  player: PlayerSimState;
  enemies: EnemyEntity[];
  projectiles: ProjectileEntity[];
  shrines: ShrineNode[];
  elapsed: number;
  hitstopTimer: number;
  cameraTrauma: number;
  seedOffset: number;
  waveIndex: number;
}

/**
 * Deterministic procedural highland heightfield.
 * Keeps the central sanctuary plaza (r <= 10) flat and wide navigable paths toward all 3 shrines
 * while raising terraced outer ridges and cliff rims beyond the playable radius.
 */
export function groundHeightAt(x: number, z: number, seedOffset = 1.0): number {
  const dist = Math.hypot(x, z);
  // Central sanctuary plaza stays level at y = 0
  if (dist < 10.5) {
    return 0;
  }

  const blend = Math.min(1, (dist - 10.5) / 14);
  const smooth = blend * blend * (3 - 2 * blend);

  const waveA = Math.sin(x * 0.085 + seedOffset) * Math.cos(z * 0.085 - seedOffset * 0.6) * 2.1;
  const waveB = Math.sin((x + z) * 0.045 + seedOffset * 1.4) * 1.4;
  const terrace = Math.round((waveA + waveB) * 2) * 0.25 + (waveA + waveB) * 0.5;

  // Natural perimeter rim rise outside playable area
  const rim = dist > 46 ? Math.pow((dist - 46) / 14, 1.8) * 6.5 : 0;

  return Math.max(-0.4, terrace * smooth + rim);
}

export function createDefaultShrines(): ShrineNode[] {
  return [
    {
      id: 'shrine-astrolabe',
      name: 'Astrolabe Spire',
      x: 0,
      z: -24,
      faction: 'order',
      attuned: false,
      color: 0xe5a94c,
    },
    {
      id: 'shrine-cypress',
      name: 'Verdant Root Altar',
      x: -24,
      z: 16,
      faction: 'verdant',
      attuned: false,
      color: 0x52c78c,
    },
    {
      id: 'shrine-tempest',
      name: 'Unbound Rift Obelisk',
      x: 25,
      z: 14,
      faction: 'unbound',
      attuned: false,
      color: 0x5ec9e8,
    },
  ];
}

export function createEnemy(
  id: string,
  archetype: EnemyArchetype,
  x: number,
  z: number,
  seedOffset: number,
  difficultyScale = 1
): EnemyEntity {
  const stats: Record<EnemyArchetype, { name: string; hp: number }> = {
    stalker: { name: 'Warden Stalker', hp: Math.round(52 * difficultyScale) },
    weaver: { name: 'Aether Weaver', hp: Math.round(44 * difficultyScale) },
    golem: { name: 'Bastion Golem', hp: Math.round(96 * difficultyScale) },
  };
  return {
    id,
    archetype,
    name: stats[archetype].name,
    x,
    y: groundHeightAt(x, z, seedOffset),
    z,
    vx: 0,
    vz: 0,
    rotY: 0,
    hp: stats[archetype].hp,
    maxHp: stats[archetype].hp,
    state: 'patrol',
    stateTimer: 0,
    attackCooldown: 1.2 + Math.random() * 1.1,
    hitFlashTimer: 0,
    koTimer: 0,
    homeX: x,
    homeZ: z,
    orbitDir: Math.random() > 0.5 ? 1 : -1,
    hasAttackToken: false,
    telegraphX: x,
    telegraphZ: z,
  };
}

export function createInitialSimulation(seedOffset = 1.0): SimulationState {
  const shrines = createDefaultShrines();
  // Spawn player on open central plaza facing North toward the tall Astrolabe Spire landmark
  const player: PlayerSimState = {
    x: 0,
    y: groundHeightAt(0, 6, seedOffset),
    z: 6,
    vx: 0,
    vy: 0,
    vz: 0,
    rotY: Math.PI, // Facing -Z (toward Astrolabe Spire)
    hp: 100,
    maxHp: 100,
    resonance: 100,
    shards: 15,
    level: 1,
    xp: 0,
    grounded: true,
    coyoteTimer: 0.11,
    jumpBufferTimer: 0,
    dashTimer: 0,
    dashCooldown: 0,
    strikeTimer: 0,
    strikeCooldown: 0,
    invulnTimer: 0,
    hitFlashTimer: 0,
    walkDistance: 0,
    squashY: 1,
    defeatedCount: 0,
  };

  // Spawn 3 distinct enemy archetypes guarding outer shrine territories (outside central plaza aggro range)
  const enemies: EnemyEntity[] = [
    createEnemy('e-stalker-1', 'stalker', -18, -22, seedOffset, 1),
    createEnemy('e-weaver-1', 'weaver', 20, -20, seedOffset, 1),
    createEnemy('e-golem-1', 'golem', 28, 18, seedOffset, 1),
    createEnemy('e-stalker-2', 'stalker', -26, 20, seedOffset, 1),
  ];

  return {
    player,
    enemies,
    projectiles: [],
    shrines,
    elapsed: 0,
    hitstopTimer: 0,
    cameraTrauma: 0,
    seedOffset,
    waveIndex: 1,
  };
}

export function spawnDifficultyWave(sim: SimulationState): void {
  sim.waveIndex += 1;
  const scale = 1 + (sim.waveIndex - 1) * 0.16;
  const archetypes: EnemyArchetype[] = ['stalker', 'weaver', 'golem'];
  const count = Math.min(4, 2 + Math.floor(sim.waveIndex / 2));

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + sim.waveIndex * 0.9;
    const r = 26 + (i % 2) * 8;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const arch = archetypes[(i + sim.waveIndex) % archetypes.length];
    sim.enemies.push(
      createEnemy(`e-w${sim.waveIndex}-${i}-${Date.now()}`, arch, x, z, sim.seedOffset, scale)
    );
  }
}

/**
 * Advances the entire 3D game simulation by clamped dt.
 * Supports sim-level hitstop, coyote time, jump buffering, variable jump cut,
 * 3 distinct enemy AI movement policies, attack token pool, and projectiles.
 */
export function stepSimulation(
  sim: SimulationState,
  rawDt: number,
  input: InputSnapshot
): SimEvent[] {
  const dt = Math.min(Math.max(rawDt, 0), 0.05);
  const events: SimEvent[] = [];

  sim.cameraTrauma = Math.max(0, sim.cameraTrauma - dt * 1.9);
  sim.player.hitFlashTimer = Math.max(0, sim.player.hitFlashTimer - dt);
  for (const e of sim.enemies) {
    e.hitFlashTimer = Math.max(0, e.hitFlashTimer - dt);
  }

  // Sim-level hitstop pauses physical integration while visual shake & hit flashes tick
  if (sim.hitstopTimer > 0) {
    sim.hitstopTimer = Math.max(0, sim.hitstopTimer - dt);
    return events;
  }

  sim.elapsed += dt;
  const p = sim.player;

  // Timers & regen
  p.dashTimer = Math.max(0, p.dashTimer - dt);
  p.dashCooldown = Math.max(0, p.dashCooldown - dt);
  p.strikeTimer = Math.max(0, p.strikeTimer - dt);
  p.strikeCooldown = Math.max(0, p.strikeCooldown - dt);
  p.invulnTimer = Math.max(0, p.invulnTimer - dt);
  p.resonance = Math.min(100, p.resonance + dt * 18);
  p.squashY += (1 - p.squashY) * (1 - Math.exp(-12 * dt));

  // Transform camera-relative input into world XZ vector
  const sinY = Math.sin(input.cameraYaw);
  const cosY = Math.cos(input.cameraYaw);
  let wishX = input.moveX * cosY + input.moveZ * sinY;
  let wishZ = -input.moveX * sinY + input.moveZ * cosY;
  const wishMag = Math.hypot(wishX, wishZ);
  if (wishMag > 1e-4) {
    wishX /= wishMag;
    wishZ /= wishMag;
  }

  // Edge-triggered Dash with input cost
  if (input.dashJustPressed && p.dashCooldown <= 0 && p.resonance >= 22) {
    const dirX = wishMag > 0.1 ? wishX : Math.sin(p.rotY);
    const dirZ = wishMag > 0.1 ? wishZ : Math.cos(p.rotY);
    p.vx = dirX * DASH_SPEED;
    p.vz = dirZ * DASH_SPEED;
    p.dashTimer = 0.2;
    p.dashCooldown = 0.85;
    p.invulnTimer = 0.28;
    p.resonance -= 22;
    p.squashY = 0.84;
    events.push({ type: 'dash', x: p.x, y: p.y + 0.8, z: p.z, weight: 0.45 });
  }

  // Horizontal acceleration with exponential damping
  if (p.dashTimer <= 0) {
    const targetVx = wishX * PLAYER_SPEED;
    const targetVz = wishZ * PLAYER_SPEED;
    const accel = p.grounded ? 14 : 7;
    const damp = 1 - Math.exp(-accel * dt);
    p.vx += (targetVx - p.vx) * damp;
    p.vz += (targetVz - p.vz) * damp;
  }

  // Smooth facing rotation toward movement direction
  if (wishMag > 0.15) {
    const targetRot = Math.atan2(wishX, wishZ);
    let diff = targetRot - p.rotY;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    p.rotY += diff * (1 - Math.exp(-14 * dt));
  }

  // Coyote time + Jump buffer
  if (p.grounded) {
    p.coyoteTimer = 0.11;
  } else {
    p.coyoteTimer = Math.max(0, p.coyoteTimer - dt);
  }

  if (input.jumpJustPressed) {
    p.jumpBufferTimer = 0.12;
  } else {
    p.jumpBufferTimer = Math.max(0, p.jumpBufferTimer - dt);
  }

  if (p.jumpBufferTimer > 0 && p.coyoteTimer > 0) {
    p.vy = JUMP_VELOCITY;
    p.grounded = false;
    p.coyoteTimer = 0;
    p.jumpBufferTimer = 0;
    p.squashY = 1.2;
    events.push({ type: 'jump', x: p.x, y: p.y, z: p.z, weight: 0.35 });
  }

  // Variable jump cut when releasing Jump early while ascending
  if (!input.jumpHeld && p.vy > 2.5) {
    p.vy *= 0.45;
  }

  // Integrate player position
  const prevX = p.x;
  const prevZ = p.z;
  p.x += p.vx * dt;
  p.z += p.vz * dt;

  // Natural perimeter boundary clamping
  const radial = Math.hypot(p.x, p.z);
  if (radial > WORLD_PLAYABLE_RADIUS) {
    const pull = WORLD_PLAYABLE_RADIUS / radial;
    p.x *= pull;
    p.z *= pull;
  }

  // Shrine plinth collision push-out (radius 2.2m)
  for (const shrine of sim.shrines) {
    const dx = p.x - shrine.x;
    const dz = p.z - shrine.z;
    const d = Math.hypot(dx, dz);
    if (d < 2.2 && d > 1e-4) {
      p.x = shrine.x + (dx / d) * 2.2;
      p.z = shrine.z + (dz / d) * 2.2;
    }
  }

  // Vertical integration & terrain landing
  p.vy -= GRAVITY * dt;
  p.y += p.vy * dt;
  const floorY = groundHeightAt(p.x, p.z, sim.seedOffset);
  if (p.y <= floorY) {
    if (!p.grounded && p.vy < -4.5) {
      p.squashY = 0.78;
      events.push({ type: 'land', x: p.x, y: floorY, z: p.z, weight: 0.3 });
    }
    p.y = floorY;
    p.vy = 0;
    p.grounded = true;
  } else {
    p.grounded = false;
  }

  if (p.grounded) {
    p.walkDistance += Math.hypot(p.x - prevX, p.z - prevZ);
  }

  // Edge-triggered Resonance Strike (melee arc + energy wave)
  if (input.strikeJustPressed && p.strikeCooldown <= 0 && p.resonance >= 14) {
    p.strikeTimer = 0.28;
    p.strikeCooldown = 0.42;
    p.resonance -= 14;
    events.push({ type: 'strike', x: p.x, y: p.y + 1.1, z: p.z, weight: 0.55 });

    // Forward energy bolt projectile
    const fwdX = Math.sin(p.rotY);
    const fwdZ = Math.cos(p.rotY);
    sim.projectiles.push({
      id: `proj-p-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      fromPlayer: true,
      x: p.x + fwdX * 1.1,
      y: p.y + 1.2,
      z: p.z + fwdZ * 1.1,
      vx: fwdX * 22,
      vy: 0,
      vz: fwdZ * 22,
      life: 0.75,
      damage: 24 + p.level * 4,
      color: 0xf4c26b,
    });

    // Immediate close-range resonance shock arc (radius 4.4m)
    for (const enemy of sim.enemies) {
      if (enemy.state === 'ko') continue;
      const dx = enemy.x - p.x;
      const dz = enemy.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= 4.6) {
        applyDamageToEnemy(sim, enemy, 28 + p.level * 5, dx, dz, events);
      }
    }
  }

  // Update Enemy Attack Token Pool
  let activeTokens = sim.enemies.filter(
    (e) => e.state !== 'ko' && e.hasAttackToken
  ).length;

  // Step 3 Distinct Enemy Archetypes
  const speedScale = 1 + Math.min(0.45, sim.elapsed / 240);
  for (const enemy of sim.enemies) {
    if (enemy.state === 'ko') {
      enemy.koTimer -= dt;
      continue;
    }

    enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);
    const dx = p.x - enemy.x;
    const dz = p.z - enemy.z;
    const dist = Math.hypot(dx, dz);
    const nx = dist > 1e-4 ? dx / dist : 0;
    const nz = dist > 1e-4 ? dz / dist : 1;

    // Smooth yaw toward player when aware
    if (dist < 26) {
      enemy.rotY = Math.atan2(nx, nz);
    }

    if (enemy.state === 'telegraph') {
      enemy.stateTimer -= dt;
      enemy.vx *= 0.85;
      enemy.vz *= 0.85;
      if (enemy.stateTimer <= 0) {
        enemy.state = 'attack';
        if (enemy.archetype === 'stalker') {
          enemy.stateTimer = 0.24;
          const ldx = enemy.telegraphX - enemy.x;
          const ldz = enemy.telegraphZ - enemy.z;
          const ld = Math.hypot(ldx, ldz) || 1;
          enemy.vx = (ldx / ld) * 19.5;
          enemy.vz = (ldz / ld) * 19.5;
        } else if (enemy.archetype === 'weaver') {
          enemy.stateTimer = 0.2;
          sim.projectiles.push({
            id: `proj-e-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            fromPlayer: false,
            x: enemy.x,
            y: enemy.y + 1.7,
            z: enemy.z,
            vx: nx * 14.5,
            vy: 0,
            vz: nz * 14.5,
            life: 2.2,
            damage: 14,
            color: 0xff5e6c,
          });
        } else {
          // Golem area shockwave slam
          enemy.stateTimer = 0.35;
          if (dist <= 4.6) {
            damagePlayer(sim, 20, events);
          }
        }
      }
    } else if (enemy.state === 'attack') {
      enemy.stateTimer -= dt;
      if (enemy.archetype === 'stalker' && dist <= 2.1) {
        damagePlayer(sim, 14, events);
      }
      if (enemy.stateTimer <= 0) {
        enemy.state = 'recover';
        enemy.stateTimer = enemy.archetype === 'golem' ? 0.95 : 0.6;
        enemy.hasAttackToken = false;
        activeTokens = Math.max(0, activeTokens - 1);
      }
    } else if (enemy.state === 'recover') {
      enemy.stateTimer -= dt;
      enemy.vx *= 0.82;
      enemy.vz *= 0.82;
      if (enemy.stateTimer <= 0) {
        enemy.state = 'approach';
        enemy.attackCooldown = enemy.archetype === 'golem' ? 2.4 : 1.7;
      }
    } else {
      // Distinct movement policies per archetype
      if (dist > 22) {
        // Patrol near home shrine
        enemy.state = 'patrol';
        const angle = sim.elapsed * 0.5 * enemy.orbitDir + enemy.homeX;
        const tx = enemy.homeX + Math.cos(angle) * 4.5;
        const tz = enemy.homeZ + Math.sin(angle) * 4.5;
        const pdx = tx - enemy.x;
        const pdz = tz - enemy.z;
        const pd = Math.hypot(pdx, pdz) || 1;
        enemy.vx = (pdx / pd) * 2.4;
        enemy.vz = (pdz / pd) * 2.4;
      } else {
        enemy.state = 'approach';
        if (enemy.archetype === 'stalker') {
          // Policy 1: Flanker/Chaser — approaches at a 32-degree flanking arc
          const flankAngle = 0.55 * enemy.orbitDir;
          const fx = nx * Math.cos(flankAngle) - nz * Math.sin(flankAngle);
          const fz = nx * Math.sin(flankAngle) + nz * Math.cos(flankAngle);
          const sp = 5.8 * speedScale;
          enemy.vx += (fx * sp - enemy.vx) * (1 - Math.exp(-8 * dt));
          enemy.vz += (fz * sp - enemy.vz) * (1 - Math.exp(-8 * dt));

          if (dist < 6.2 && enemy.attackCooldown <= 0 && activeTokens < MAX_CONCURRENT_ATTACKERS) {
            enemy.state = 'telegraph';
            enemy.stateTimer = 0.55;
            enemy.hasAttackToken = true;
            activeTokens += 1;
            enemy.telegraphX = p.x;
            enemy.telegraphZ = p.z;
            events.push({ type: 'enemy_telegraph', x: enemy.x, y: enemy.y + 1, z: enemy.z, weight: 0.4 });
          }
        } else if (enemy.archetype === 'weaver') {
          // Policy 2: Kiter/Ranged — maintains 11..15m ring and strafes tangentially
          const tangentX = -nz * enemy.orbitDir;
          const tangentZ = nx * enemy.orbitDir;
          const radialPush = dist < 10.5 ? -1 : dist > 15 ? 0.8 : 0;
          const sp = 4.2 * speedScale;
          enemy.vx += ((nx * radialPush + tangentX * 0.85) * sp - enemy.vx) * (1 - Math.exp(-6 * dt));
          enemy.vz += ((nz * radialPush + tangentZ * 0.85) * sp - enemy.vz) * (1 - Math.exp(-6 * dt));

          if (dist >= 7 && dist <= 18 && enemy.attackCooldown <= 0 && activeTokens < MAX_CONCURRENT_ATTACKERS) {
            enemy.state = 'telegraph';
            enemy.stateTimer = 0.65;
            enemy.hasAttackToken = true;
            activeTokens += 1;
            enemy.telegraphX = p.x;
            enemy.telegraphZ = p.z;
            events.push({ type: 'enemy_telegraph', x: enemy.x, y: enemy.y + 1.5, z: enemy.z, weight: 0.45 });
          }
        } else {
          // Policy 3: Bastion Golem — slow deliberate advance guarding territory, heavy AoE telegraph
          const sp = 3.1 * speedScale;
          enemy.vx += (nx * sp - enemy.vx) * (1 - Math.exp(-5 * dt));
          enemy.vz += (nz * sp - enemy.vz) * (1 - Math.exp(-5 * dt));

          if (dist < 4.5 && enemy.attackCooldown <= 0 && activeTokens < MAX_CONCURRENT_ATTACKERS) {
            enemy.state = 'telegraph';
            enemy.stateTimer = 0.75;
            enemy.hasAttackToken = true;
            activeTokens += 1;
            enemy.telegraphX = enemy.x;
            enemy.telegraphZ = enemy.z;
            events.push({ type: 'enemy_telegraph', x: enemy.x, y: enemy.y + 1.2, z: enemy.z, weight: 0.65 });
          }
        }
      }
    }

    enemy.x += enemy.vx * dt;
    enemy.z += enemy.vz * dt;
    const er = Math.hypot(enemy.x, enemy.z);
    if (er > WORLD_PLAYABLE_RADIUS - 2) {
      enemy.x *= (WORLD_PLAYABLE_RADIUS - 2) / er;
      enemy.z *= (WORLD_PLAYABLE_RADIUS - 2) / er;
    }
    enemy.y = groundHeightAt(enemy.x, enemy.z, sim.seedOffset);
  }

  // Clean up completed KO dissolve transitions
  sim.enemies = sim.enemies.filter((e) => !(e.state === 'ko' && e.koTimer <= 0));

  // Step projectiles
  for (let i = sim.projectiles.length - 1; i >= 0; i--) {
    const proj = sim.projectiles[i];
    proj.x += proj.vx * dt;
    proj.y += proj.vy * dt;
    proj.z += proj.vz * dt;
    proj.life -= dt;

    let remove = proj.life <= 0;
    if (!remove && proj.fromPlayer) {
      for (const enemy of sim.enemies) {
        if (enemy.state === 'ko') continue;
        const d = Math.hypot(enemy.x - proj.x, enemy.z - proj.z);
        if (d < 1.65) {
          applyDamageToEnemy(sim, enemy, proj.damage, proj.vx, proj.vz, events);
          remove = true;
          break;
        }
      }
    } else if (!remove && !proj.fromPlayer) {
      const d = Math.hypot(p.x - proj.x, p.z - proj.z);
      if (d < 1.15 && Math.abs(p.y + 1.0 - proj.y) < 1.6) {
        damagePlayer(sim, proj.damage, events);
        remove = true;
      }
    }

    if (remove) {
      sim.projectiles.splice(i, 1);
    }
  }

  return events;
}

function applyDamageToEnemy(
  sim: SimulationState,
  enemy: EnemyEntity,
  damage: number,
  dirX: number,
  dirZ: number,
  events: SimEvent[]
): void {
  enemy.hp = Math.max(0, enemy.hp - damage);
  enemy.hitFlashTimer = 0.08;
  const len = Math.hypot(dirX, dirZ) || 1;
  enemy.vx = (dirX / len) * 9;
  enemy.vz = (dirZ / len) * 9;

  if (enemy.hp <= 0) {
    enemy.state = 'ko';
    enemy.koTimer = 0.42;
    enemy.hasAttackToken = false;
    sim.hitstopTimer = 0.055;
    sim.cameraTrauma = Math.min(1, sim.cameraTrauma + 0.55);
    sim.player.defeatedCount += 1;
    const reward = enemy.archetype === 'golem' ? 35 : enemy.archetype === 'weaver' ? 20 : 15;
    sim.player.shards += reward;
    sim.player.xp += reward;
    if (sim.player.xp >= sim.player.level * 60) {
      sim.player.xp -= sim.player.level * 60;
      sim.player.level += 1;
      sim.player.maxHp = Math.min(200, sim.player.maxHp + 10);
      sim.player.hp = Math.min(sim.player.maxHp, sim.player.hp + 25);
    }
    events.push({ type: 'enemy_ko', x: enemy.x, y: enemy.y + 1, z: enemy.z, weight: 0.95 });
  } else {
    sim.hitstopTimer = 0.032;
    sim.cameraTrauma = Math.min(1, sim.cameraTrauma + 0.25);
    events.push({ type: 'enemy_hit', x: enemy.x, y: enemy.y + 1, z: enemy.z, weight: 0.65 });
  }
}

function damagePlayer(sim: SimulationState, amount: number, events: SimEvent[]): void {
  const p = sim.player;
  if (p.invulnTimer > 0) return;
  p.hp = Math.max(0, p.hp - amount);
  p.invulnTimer = 0.75;
  p.hitFlashTimer = 0.14;
  sim.hitstopTimer = 0.05;
  sim.cameraTrauma = Math.min(1, sim.cameraTrauma + 0.65);
  events.push({ type: 'player_hurt', x: p.x, y: p.y + 1, z: p.z, weight: 0.9 });
}

export function findNearestShrine(
  x: number,
  z: number,
  shrines: ShrineNode[]
): { id: string; name: string; distance: number } | null {
  let best: { id: string; name: string; distance: number } | null = null;
  for (const s of shrines) {
    const d = Math.hypot(s.x - x, s.z - z);
    if (!best || d < best.distance) {
      best = { id: s.id, name: s.name, distance: d };
    }
  }
  return best;
}

export function computeThreatLevel(player: PlayerSimState, enemies: EnemyEntity[]): number {
  let threat = 0;
  for (const e of enemies) {
    if (e.state === 'ko') continue;
    const d = Math.hypot(e.x - player.x, e.z - player.z);
    if (d < 22) {
      const factor = (22 - d) / 22;
      const telegraphBonus = e.state === 'telegraph' || e.state === 'attack' ? 0.45 : 0;
      threat = Math.max(threat, Math.min(1, factor + telegraphBonus));
    }
  }
  return Number(threat.toFixed(3));
}
