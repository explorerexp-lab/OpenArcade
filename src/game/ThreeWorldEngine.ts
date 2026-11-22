import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type {
  BiomeKey,
  GamePhase,
  HudSnapshot,
  NarrativeBeacon,
  RemoteWayfarer,
} from './types';
import { BIOME_PALETTES } from './questEngine';
import {
  computeThreatLevel,
  findNearestShrine,
  groundHeightAt,
  stepSimulation,
  type InputSnapshot,
  type SimEvent,
  type SimulationState,
} from './simulation';
import {
  buildBeaconModel,
  buildEnemyModel,
  buildShrineMonolith,
  buildWayfarerModel,
  createProceduralTextures,
  type ProceduralTexturePack,
} from './proceduralModels';

// Pre-allocated zero-GC scratch math helpers
const _vec3A = new THREE.Vector3();
const _vec3B = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scaleVec = new THREE.Vector3();
const _color = new THREE.Color();

interface PooledParticle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  color: number;
}

interface EnemyVisual {
  group: THREE.Group;
  bodyGroup: THREE.Group;
  telegraphRing: THREE.Mesh;
  coreMaterials: THREE.MeshStandardMaterial[];
}

interface ShrineVisual {
  id: string;
  group: THREE.Group;
  outerRing: THREE.Mesh;
  innerRing: THREE.Mesh;
  coreCrystal: THREE.Mesh;
  coreMat: THREE.MeshStandardMaterial;
}

interface RemoteVisual {
  group: THREE.Group;
  bodyGroup: THREE.Group;
  lanternCrystal: THREE.Mesh;
  targetX: number;
  targetY: number;
  targetZ: number;
  targetRotY: number;
}

export interface EngineCallbacks {
  onHudUpdate: (snapshot: HudSnapshot) => void;
  onSimEvents: (events: SimEvent[]) => void;
  onPlayerDefeated: () => void;
  onInteractNearestShrine: (shrineId: string) => void;
  onTogglePause: () => void;
}

function detectSoftwareGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export class ThreeWorldEngine {
  private container: HTMLElement;
  private isSoftwareGl: boolean;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private resizeObserver: ResizeObserver;

  private sim: SimulationState;
  private callbacks: EngineCallbacks;
  private phase: GamePhase = 'title';
  private biomeKey: BiomeKey = 'highland_dusk';
  private texPack: ProceduralTexturePack;

  // Lights & sky
  private keyLight!: THREE.DirectionalLight;
  private hemiLight!: THREE.HemisphereLight;
  private skyMat!: THREE.ShaderMaterial;
  private terrainMesh!: THREE.Mesh;
  private waterMesh!: THREE.Mesh;
  private plazaGroup!: THREE.Group;

  // Instanced foliage & rocks
  private trunkInstanced!: THREE.InstancedMesh;
  private crownInstanced!: THREE.InstancedMesh;
  private rockInstanced!: THREE.InstancedMesh;

  // Actors & visuals
  private playerVisual!: ReturnType<typeof buildWayfarerModel>;
  private shrineVisuals: ShrineVisual[] = [];
  private enemyVisuals: Map<string, EnemyVisual> = new Map();
  private projectileMeshes: Map<string, THREE.Mesh> = new Map();
  private remoteVisuals: Map<string, RemoteVisual> = new Map();
  private beaconVisuals: Map<string, THREE.Group> = new Map();

  // Shared projectile geometry
  private projGeo = new THREE.OctahedronGeometry(0.28, 1);

  // Zero-GC pooled particle ring buffer (160 particles)
  private particleCount = 160;
  private particles: PooledParticle[] = [];
  private particleCursor = 0;
  private particleMesh!: THREE.InstancedMesh;

  // Input state (continuous held vs single-frame edge-triggered)
  private keysHeld = new Set<string>();
  private justJump = false;
  private justDash = false;
  private justStrike = false;
  private touchMoveX = 0;
  private touchMoveZ = 0;

  // Camera orbit state
  private cameraYaw = 0;
  private cameraPitch = 0.36;
  private isDraggingCamera = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private currentCamPos = new THREE.Vector3(0, 12, 24);
  private currentLookAt = new THREE.Vector3(0, 2, -6);
  private titleOrbitAngle = 0;

  // Loop & pacing
  private disposed = false;
  private frameId = 0;
  private lastTickTime = performance.now();
  private hudEmitAccum = 0;
  private defeatTriggered = false;

  constructor(
    container: HTMLElement,
    initialSim: SimulationState,
    initialBiome: BiomeKey,
    callbacks: EngineCallbacks
  ) {
    this.container = container;
    this.sim = initialSim;
    this.biomeKey = initialBiome;
    this.callbacks = callbacks;
    this.isSoftwareGl = detectSoftwareGl();

    const width = Math.max(container.clientWidth, window.innerWidth, 320);
    const height = Math.max(container.clientHeight, window.innerHeight, 240);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: this.isSoftwareGl,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2)
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setSize(width, height);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(56, width / height, 0.25, 260);

    // Mandatory studio RoomEnvironment PBR reflections on every device
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04
    ).texture;
    pmremGenerator.dispose();

    const palette = BIOME_PALETTES[this.biomeKey];
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.texPack = createProceduralTextures(palette, maxAniso);

    this.setupAtmosphereAndLighting(palette);
    this.setupTerrainAndSanctuary(palette);
    this.setupInstancedEnvironment(palette);
    this.setupShrines();
    this.setupPlayer(palette);
    this.setupParticlePool();
    this.syncEnemyVisuals();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.bindEvents();

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    this.lastTickTime = performance.now();
    this.tick();
  }

  private setupAtmosphereAndLighting(palette: (typeof BIOME_PALETTES)[BiomeKey]): void {
    this.scene.background = new THREE.Color(palette.fogColor);
    this.scene.fog = new THREE.FogExp2(palette.fogColor, palette.fogDensity);

    // Horizon-matched atmospheric sky dome
    const skyGeo = new THREE.SphereGeometry(190, 24, 16);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(palette.skyTop) },
        horizonColor: { value: new THREE.Color(palette.skyHorizon) },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        varying vec3 vWorldPos;
        void main() {
          float h = clamp(normalize(vWorldPos).y * 1.45, 0.0, 1.0);
          vec3 col = mix(horizonColor, topColor, pow(h, 0.72));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const skyDome = new THREE.Mesh(skyGeo, this.skyMat);
    this.scene.add(skyDome);

    // Warm key directional light + cool HemisphereLight fill + subtle rim
    this.keyLight = new THREE.DirectionalLight(
      palette.keyLightColor,
      palette.keyLightIntensity
    );
    this.keyLight.position.set(36, 52, 28);
    this.keyLight.castShadow = !this.isSoftwareGl;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.camera.near = 5;
    this.keyLight.shadow.camera.far = 150;
    const d = 48;
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = d;
    this.keyLight.shadow.camera.bottom = -d;
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.02;
    this.scene.add(this.keyLight);

    this.hemiLight = new THREE.HemisphereLight(
      palette.hemiSkyColor,
      palette.hemiGroundColor,
      0.95
    );
    this.scene.add(this.hemiLight);

    const rimLight = new THREE.DirectionalLight(0x9bc4e8, 0.55);
    rimLight.position.set(-42, 24, -36);
    this.scene.add(rimLight);
  }

  private setupTerrainAndSanctuary(palette: (typeof BIOME_PALETTES)[BiomeKey]): void {
    // Extended outdoor terrain (168m x 168m) blending seamlessly into horizon fog
    const terrainGeo = new THREE.PlaneGeometry(168, 168, 72, 72);
    terrainGeo.rotateX(-Math.PI / 2);
    this.applyTerrainHeights(terrainGeo);

    const terrainMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: this.texPack.terrainColor,
      bumpMap: this.texPack.terrainBump,
      bumpScale: 0.14,
      roughness: 0.9,
      metalness: 0.04,
    });
    this.terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    this.terrainMesh.receiveShadow = true;
    this.scene.add(this.terrainMesh);

    // Subtle recessed reflective sanctuary basin ring around outer vista
    const waterGeo = new THREE.RingGeometry(54, 155, 48);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: palette.waterColor,
      roughness: 0.16,
      metalness: 0.65,
      transparent: true,
      opacity: 0.85,
    });
    this.waterMesh = new THREE.Mesh(waterGeo, waterMat);
    this.waterMesh.position.y = -0.35;
    this.scene.add(this.waterMesh);

    // Central Sanctuary Stone Plaza & radial stepping stones (offset Y >= 0.03 to avoid Z-fighting)
    this.plazaGroup = new THREE.Group();
    const stoneMat = new THREE.MeshStandardMaterial({
      color: palette.stoneTint,
      roughness: 0.78,
      metalness: 0.08,
      bumpMap: this.texPack.stoneBump,
      bumpScale: 0.05,
    });
    const brassInlayMat = new THREE.MeshStandardMaterial({
      color: 0xd4a459,
      roughness: 0.25,
      metalness: 0.88,
    });

    const dais = new THREE.Mesh(new THREE.CylinderGeometry(9.2, 9.8, 0.26, 24), stoneMat);
    dais.position.y = -0.1;
    dais.receiveShadow = true;
    this.plazaGroup.add(dais);

    const astrolabeRing = new THREE.Mesh(
      new THREE.RingGeometry(6.8, 7.15, 48),
      brassInlayMat
    );
    astrolabeRing.rotation.x = -Math.PI / 2;
    astrolabeRing.position.y = 0.04;
    this.plazaGroup.add(astrolabeRing);

    const innerCompass = new THREE.Mesh(
      new THREE.RingGeometry(2.6, 2.82, 36),
      brassInlayMat
    );
    innerCompass.rotation.x = -Math.PI / 2;
    innerCompass.position.y = 0.04;
    this.plazaGroup.add(innerCompass);

    // Curved stepping flagstone paths linking central plaza edge to each of the 3 shrines
    const stepGeo = new THREE.CylinderGeometry(1.15, 1.25, 0.14, 7);
    for (const shrine of this.sim.shrines) {
      const steps = 6;
      for (let i = 1; i <= steps; i++) {
        const t = i / (steps + 1);
        const sx = shrine.x * t + Math.sin(t * Math.PI) * 1.6;
        const sz = shrine.z * t;
        // Keep central astrolabe dais completely unobstructed
        if (Math.hypot(sx, sz) < 10.6) continue;
        const sy = groundHeightAt(sx, sz, this.sim.seedOffset);
        const pad = new THREE.Mesh(stepGeo, stoneMat);
        pad.position.set(sx, sy + 0.02, sz);
        pad.receiveShadow = true;
        this.plazaGroup.add(pad);
      }
    }

    this.scene.add(this.plazaGroup);
  }

  private applyTerrainHeights(geo: THREE.BufferGeometry): void {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, groundHeightAt(x, z, this.sim.seedOffset));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }

  private setupInstancedEnvironment(palette: (typeof BIOME_PALETTES)[BiomeKey]): void {
    // 56 ancient highland cypress trees (shared trunk + layered cone crowns)
    const treeCount = 56;
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.34, 3.2, 7);
    trunkGeo.translate(0, 1.6, 0);
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x574333,
      roughness: 0.88,
      metalness: 0.04,
    });
    this.trunkInstanced = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
    this.trunkInstanced.castShadow = !this.isSoftwareGl;
    this.trunkInstanced.receiveShadow = true;

    const crownGeo = new THREE.ConeGeometry(1.65, 4.9, 8);
    crownGeo.translate(0, 4.7, 0);
    const crownMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.78,
      metalness: 0.04,
    });
    this.crownInstanced = new THREE.InstancedMesh(crownGeo, crownMat, treeCount);
    this.crownInstanced.castShadow = !this.isSoftwareGl;
    this.crownInstanced.receiveShadow = true;

    // 48 basalt cliff boulders bounding natural outdoor perimeter & micro-vignettes
    const rockCount = 48;
    const rockGeo = new THREE.DodecahedronGeometry(1.5, 0);
    rockGeo.translate(0, 0.85, 0);
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.86,
      metalness: 0.1,
      bumpMap: this.texPack.stoneBump,
      bumpScale: 0.08,
    });
    this.rockInstanced = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
    this.rockInstanced.castShadow = !this.isSoftwareGl;
    this.rockInstanced.receiveShadow = true;

    this.populateInstancedProps(palette);
    this.scene.add(this.trunkInstanced, this.crownInstanced, this.rockInstanced);
  }

  private populateInstancedProps(palette: (typeof BIOME_PALETTES)[BiomeKey]): void {
    const baseFoliage = new THREE.Color(palette.foliageBase);
    const baseRock = new THREE.Color(palette.stoneTint);

    let placedTrees = 0;
    let attempt = 0;
    while (placedTrees < this.trunkInstanced.count && attempt < 400) {
      attempt++;
      const angle = (attempt * 2.39996 + this.sim.seedOffset) % (Math.PI * 2);
      const radius = 14 + ((attempt * 17.3) % 44);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      // Keep clear of central plaza, north sightline, and shrine plinths
      if (Math.abs(x) < 4.5 && z < 8 && z > -26) continue;
      if (this.sim.shrines.some((s) => Math.hypot(s.x - x, s.z - z) < 6.5)) continue;

      const y = groundHeightAt(x, z, this.sim.seedOffset);
      const scale = 0.85 + ((attempt * 7) % 10) * 0.032; // ±15% natural variation
      _vec3A.set(x, y - 0.12, z);
      _quat.setFromAxisAngle(_vec3B.set(0, 1, 0), angle * 2.1);
      _scaleVec.set(scale, scale * (0.92 + (attempt % 4) * 0.06), scale);
      _mat4.compose(_vec3A, _quat, _scaleVec);

      this.trunkInstanced.setMatrixAt(placedTrees, _mat4);
      this.crownInstanced.setMatrixAt(placedTrees, _mat4);

      _color.copy(baseFoliage).offsetHSL(((attempt % 5) - 2) * 0.015, 0, ((attempt % 7) - 3) * 0.02);
      this.crownInstanced.setColorAt(placedTrees, _color);
      placedTrees++;
    }
    this.trunkInstanced.instanceMatrix.needsUpdate = true;
    this.crownInstanced.instanceMatrix.needsUpdate = true;
    if (this.crownInstanced.instanceColor) this.crownInstanced.instanceColor.needsUpdate = true;
    this.trunkInstanced.computeBoundingSphere();
    this.crownInstanced.computeBoundingSphere();

    for (let i = 0; i < this.rockInstanced.count; i++) {
      const isPerimeter = i < 32;
      const angle = (i / (isPerimeter ? 32 : 16)) * Math.PI * 2 + this.sim.seedOffset * 0.3;
      const radius = isPerimeter ? 49 + (i % 4) * 2.8 : 13 + ((i * 11.7) % 28);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = groundHeightAt(x, z, this.sim.seedOffset);
      const sx = isPerimeter ? 2.4 + (i % 3) * 0.85 : 0.75 + (i % 4) * 0.25;
      const sy = isPerimeter ? 2.2 + (i % 4) * 0.7 : 0.55 + (i % 3) * 0.22;

      _vec3A.set(x, y - 0.3, z);
      _quat.setFromAxisAngle(_vec3B.set(0, 1, 0), angle);
      _scaleVec.set(sx, sy, sx * 0.9);
      _mat4.compose(_vec3A, _quat, _scaleVec);

      this.rockInstanced.setMatrixAt(i, _mat4);
      _color.copy(baseRock).offsetHSL(0, 0, ((i % 5) - 2) * 0.035);
      this.rockInstanced.setColorAt(i, _color);
    }
    this.rockInstanced.instanceMatrix.needsUpdate = true;
    if (this.rockInstanced.instanceColor) this.rockInstanced.instanceColor.needsUpdate = true;
    this.rockInstanced.computeBoundingSphere();
  }

  private setupShrines(): void {
    for (const shrine of this.sim.shrines) {
      const built = buildShrineMonolith(
        shrine,
        this.texPack.stoneBump,
        this.texPack.contactShadow
      );
      const y = groundHeightAt(shrine.x, shrine.z, this.sim.seedOffset);
      built.group.position.set(shrine.x, y, shrine.z);
      this.scene.add(built.group);
      this.shrineVisuals.push({ id: shrine.id, ...built });
    }
  }

  private setupPlayer(palette: (typeof BIOME_PALETTES)[BiomeKey]): void {
    this.playerVisual = buildWayfarerModel(
      palette.accentColor,
      this.texPack.contactShadow,
      false
    );
    this.playerVisual.group.position.set(
      this.sim.player.x,
      this.sim.player.y,
      this.sim.player.z
    );
    this.scene.add(this.playerVisual.group);
  }

  private setupParticlePool(): void {
    const pGeo = new THREE.OctahedronGeometry(0.14, 0);
    const pMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.particleMesh = new THREE.InstancedMesh(pGeo, pMat, this.particleCount);
    this.particleMesh.frustumCulled = false;

    for (let i = 0; i < this.particleCount; i++) {
      // Seed first 36 slots as drifting ambient sunlit highland embers
      const isAmbient = i < 36;
      const angle = (i / 36) * Math.PI * 2;
      const r = 4 + (i % 12) * 3.2;
      this.particles.push({
        active: isAmbient,
        x: Math.cos(angle) * r,
        y: 1.5 + (i % 6) * 1.1,
        z: Math.sin(angle) * r,
        vx: (Math.random() - 0.5) * 0.35,
        vy: 0.22 + Math.random() * 0.25,
        vz: (Math.random() - 0.5) * 0.35,
        life: isAmbient ? 8 + Math.random() * 6 : 0,
        maxLife: 12,
        size: isAmbient ? 0.45 : 0.0001,
        color: 0xf4c77b,
      });
    }
    this.scene.add(this.particleMesh);
  }

  private spawnParticleBurst(
    x: number,
    y: number,
    z: number,
    count: number,
    color: number,
    speed: number
  ): void {
    for (let i = 0; i < count; i++) {
      const idx = 36 + (this.particleCursor % (this.particleCount - 36));
      this.particleCursor++;
      const p = this.particles[idx];
      const theta = Math.random() * Math.PI * 2;
      const up = 0.35 + Math.random() * 0.9;
      p.active = true;
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = Math.cos(theta) * speed * (0.4 + Math.random() * 0.8);
      p.vy = up * speed;
      p.vz = Math.sin(theta) * speed * (0.4 + Math.random() * 0.8);
      p.maxLife = 0.32 + Math.random() * 0.35;
      p.life = p.maxLife;
      p.size = 0.75 + Math.random() * 0.85;
      p.color = color;
    }
  }

  private syncEnemyVisuals(): void {
    const liveIds = new Set(this.sim.enemies.map((e) => e.id));

    for (const [id, vis] of this.enemyVisuals.entries()) {
      if (!liveIds.has(id)) {
        this.scene.remove(vis.group);
        this.enemyVisuals.delete(id);
      }
    }

    for (const enemy of this.sim.enemies) {
      if (!this.enemyVisuals.has(enemy.id)) {
        const built = buildEnemyModel(enemy.archetype, this.texPack.contactShadow);
        built.group.position.set(enemy.x, enemy.y, enemy.z);
        this.scene.add(built.group);
        this.enemyVisuals.set(enemy.id, built);
      }
    }
  }

  private syncProjectiles(): void {
    const liveIds = new Set(this.sim.projectiles.map((p) => p.id));
    for (const [id, mesh] of this.projectileMeshes.entries()) {
      if (!liveIds.has(id)) {
        this.scene.remove(mesh);
        (mesh.material as THREE.Material).dispose();
        this.projectileMeshes.delete(id);
      }
    }
    for (const proj of this.sim.projectiles) {
      let mesh = this.projectileMeshes.get(proj.id);
      if (!mesh) {
        const mat = new THREE.MeshStandardMaterial({
          color: proj.color,
          emissive: proj.color,
          emissiveIntensity: 2.0,
          roughness: 0.15,
        });
        mesh = new THREE.Mesh(this.projGeo, mat);
        this.scene.add(mesh);
        this.projectileMeshes.set(proj.id, mesh);
      }
      mesh.position.set(proj.x, proj.y, proj.z);
      mesh.rotation.y += 0.18;
      mesh.rotation.x += 0.12;
    }
  }

  public setPhase(phase: GamePhase): void {
    this.phase = phase;
    if (phase === 'playing') {
      this.keysHeld.clear();
      this.justJump = false;
      this.justDash = false;
      this.justStrike = false;
      this.defeatTriggered = false;
    }
  }

  public setSimulation(sim: SimulationState): void {
    this.sim = sim;
    this.defeatTriggered = false;
    this.syncEnemyVisuals();
  }

  public applyBiome(biomeKey: BiomeKey, newSeedOffset?: number): void {
    this.biomeKey = biomeKey;
    const palette = BIOME_PALETTES[biomeKey];
    if (typeof newSeedOffset === 'number') {
      this.sim.seedOffset = newSeedOffset;
    } else {
      this.sim.seedOffset = palette.seedOffset;
    }

    // Update sky, fog, lighting
    this.scene.background = new THREE.Color(palette.fogColor);
    this.scene.fog = new THREE.FogExp2(palette.fogColor, palette.fogDensity);
    this.skyMat.uniforms.topColor.value.setHex(palette.skyTop);
    this.skyMat.uniforms.horizonColor.value.setHex(palette.skyHorizon);
    this.keyLight.color.setHex(palette.keyLightColor);
    this.keyLight.intensity = palette.keyLightIntensity;
    this.hemiLight.color.setHex(palette.hemiSkyColor);
    this.hemiLight.groundColor.setHex(palette.hemiGroundColor);
    (this.waterMesh.material as THREE.MeshStandardMaterial).color.setHex(palette.waterColor);

    // Regenerate terrain textures & re-displace terrain + grounded props
    const oldPack = this.texPack;
    this.texPack = createProceduralTextures(
      palette,
      this.renderer.capabilities.getMaxAnisotropy()
    );
    const tMat = this.terrainMesh.material as THREE.MeshStandardMaterial;
    tMat.map = this.texPack.terrainColor;
    tMat.bumpMap = this.texPack.terrainBump;
    tMat.needsUpdate = true;
    oldPack.terrainColor.dispose();
    oldPack.terrainBump.dispose();
    oldPack.stoneBump.dispose();
    oldPack.contactShadow.dispose();

    this.applyTerrainHeights(this.terrainMesh.geometry);
    this.populateInstancedProps(palette);

    // Re-ground shrines & player cleanly
    for (const sVis of this.shrineVisuals) {
      const shrine = this.sim.shrines.find((s) => s.id === sVis.id);
      if (shrine) {
        sVis.group.position.set(
          shrine.x,
          groundHeightAt(shrine.x, shrine.z, this.sim.seedOffset),
          shrine.z
        );
      }
    }
    this.sim.player.y = groundHeightAt(
      this.sim.player.x,
      this.sim.player.z,
      this.sim.seedOffset
    );
  }

  public updateRemotePlayers(players: RemoteWayfarer[]): void {
    const activeIds = new Set(players.map((p) => p.uid));
    for (const [uid, vis] of this.remoteVisuals.entries()) {
      if (!activeIds.has(uid)) {
        this.scene.remove(vis.group);
        this.remoteVisuals.delete(uid);
      }
    }
    const factionColors: Record<string, number> = {
      order: 0xe5a94c,
      verdant: 0x52c78c,
      unbound: 0x5ec9e8,
      neutral: 0xd8c8a8,
    };
    for (const p of players) {
      let vis = this.remoteVisuals.get(p.uid);
      if (!vis) {
        const built = buildWayfarerModel(
          factionColors[p.faction] ?? 0x5ec9e8,
          this.texPack.contactShadow,
          true
        );
        built.group.position.set(p.x, p.y, p.z);
        this.scene.add(built.group);
        vis = {
          group: built.group,
          bodyGroup: built.bodyGroup,
          lanternCrystal: built.lanternCrystal,
          targetX: p.x,
          targetY: p.y,
          targetZ: p.z,
          targetRotY: p.rotY,
        };
        this.remoteVisuals.set(p.uid, vis);
      } else {
        vis.targetX = p.x;
        vis.targetY = p.y;
        vis.targetZ = p.z;
        vis.targetRotY = p.rotY;
      }
    }
  }

  public updateBeacons(beacons: NarrativeBeacon[]): void {
    const activeIds = new Set(beacons.map((b) => b.id));
    for (const [id, mesh] of this.beaconVisuals.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(mesh);
        this.beaconVisuals.delete(id);
      }
    }
    const factionColors: Record<string, number> = {
      order: 0xe5a94c,
      verdant: 0x52c78c,
      unbound: 0x5ec9e8,
      neutral: 0xd8c8a8,
    };
    for (const b of beacons) {
      if (!this.beaconVisuals.has(b.id)) {
        const model = buildBeaconModel(
          factionColors[b.faction] ?? 0xe5a94c,
          this.texPack.contactShadow
        );
        const y = groundHeightAt(b.x, b.z, this.sim.seedOffset);
        model.position.set(b.x, y, b.z);
        this.scene.add(model);
        this.beaconVisuals.set(b.id, model);
      }
    }
  }

  // Mobile Touch Control APIs
  public setTouchJoystick(x: number, z: number): void {
    this.touchMoveX = Math.max(-1, Math.min(1, x));
    this.touchMoveZ = Math.max(-1, Math.min(1, z));
  }

  public triggerTouchAction(action: 'jump' | 'dash' | 'strike' | 'interact'): void {
    if (this.phase !== 'playing') return;
    if (action === 'jump') this.justJump = true;
    if (action === 'dash') this.justDash = true;
    if (action === 'strike') this.justStrike = true;
    if (action === 'interact') {
      const nearest = findNearestShrine(
        this.sim.player.x,
        this.sim.player.z,
        this.sim.shrines
      );
      if (nearest && nearest.distance <= 8.5) {
        this.callbacks.onInteractNearestShrine(nearest.id);
      }
    }
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable)
    ) {
      return;
    }

    const code = e.code;
    if (code === 'Escape' || code === 'KeyP') {
      if (this.phase === 'playing' || this.phase === 'paused') {
        e.preventDefault();
        this.callbacks.onTogglePause();
      }
      return;
    }

    if (this.phase !== 'playing') return;

    if (!this.keysHeld.has(code)) {
      if (code === 'Space') {
        e.preventDefault();
        this.justJump = true;
      } else if (code === 'ShiftLeft' || code === 'ShiftRight') {
        this.justDash = true;
      } else if (code === 'KeyF') {
        this.justStrike = true;
      } else if (code === 'KeyE') {
        const nearest = findNearestShrine(
          this.sim.player.x,
          this.sim.player.z,
          this.sim.shrines
        );
        if (nearest && nearest.distance <= 8.5) {
          this.callbacks.onInteractNearestShrine(nearest.id);
        }
      }
    }
    this.keysHeld.add(code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keysHeld.delete(e.code);
  };

  private onBlur = () => {
    this.keysHeld.clear();
    this.isDraggingCamera = false;
    this.touchMoveX = 0;
    this.touchMoveZ = 0;
  };

  private onPointerDown = (e: PointerEvent) => {
    if (this.phase !== 'playing') return;
    if (e.target !== this.renderer.domElement) return;
    this.isDraggingCamera = true;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.isDraggingCamera || this.phase !== 'playing') return;
    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.cameraYaw -= dx * 0.0055;
    this.cameraPitch = Math.max(0.14, Math.min(0.95, this.cameraPitch + dy * 0.004));
  };

  private onPointerUp = () => {
    this.isDraggingCamera = false;
  };

  private onContextLost = (e: Event) => {
    e.preventDefault();
  };

  private bindEvents(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onBlur);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
  }

  private handleResize(): void {
    if (this.disposed) return;
    const width = Math.max(this.container.clientWidth, 320);
    const height = Math.max(this.container.clientHeight, 240);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.render(this.scene, this.camera);
  }

  private scheduleAfterSoftwareDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (gl && typeof gl.fenceSync === 'function') {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (this.disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(cb, 80);
        }
      };
      this.frameId = window.setTimeout(poll, 5);
    } else {
      this.frameId = window.setTimeout(cb, 80);
    }
  }

  private tick = (): void => {
    if (this.disposed) return;

    const now = performance.now();
    const rawDt = (now - this.lastTickTime) / 1000;
    this.lastTickTime = now;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);

    this.updateScene(dt);
    this.renderer.render(this.scene, this.camera);

    if (this.isSoftwareGl) {
      this.scheduleAfterSoftwareDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private updateScene(dt: number): void {
    // Animate monument rings & crystals in all states except paused
    const animScale = this.phase === 'paused' ? 0 : 1;
    const t = performance.now() * 0.001;

    if (animScale > 0) {
      for (let i = 0; i < this.shrineVisuals.length; i++) {
        const sv = this.shrineVisuals[i];
        sv.outerRing.rotation.y += dt * 0.55;
        sv.outerRing.rotation.x = Math.sin(t * 0.6 + i) * 0.35;
        sv.innerRing.rotation.z -= dt * 0.85;
        sv.innerRing.rotation.y += dt * 0.4;
        sv.coreCrystal.position.y = 4.2 + Math.sin(t * 1.8 + i) * 0.24;
        sv.coreCrystal.rotation.y += dt * 1.1;
      }
    }

    if (this.phase === 'title') {
      // Live World Camera Tour — unobstructed golden-hour pan across central plaza toward Astrolabe Spire
      this.titleOrbitAngle += dt * 0.14;
      const camX = -4.5 + Math.sin(this.titleOrbitAngle) * 3.8;
      const camZ = 9.0 + Math.cos(this.titleOrbitAngle) * 2.4;
      const camY = 5.6 + Math.sin(this.titleOrbitAngle * 1.4) * 0.65;
      this.camera.position.set(camX, camY, camZ);
      this.camera.lookAt(-3.2, 3.4, -22);
      this.updateParticles(dt);
      return;
    }

    if (this.phase === 'playing') {
      // Keyboard + Touch movement axes
      let moveX = this.touchMoveX;
      let moveZ = this.touchMoveZ;
      if (this.keysHeld.has('KeyA') || this.keysHeld.has('ArrowLeft')) moveX -= 1;
      if (this.keysHeld.has('KeyD') || this.keysHeld.has('ArrowRight')) moveX += 1;
      if (this.keysHeld.has('KeyW') || this.keysHeld.has('ArrowUp')) moveZ -= 1;
      if (this.keysHeld.has('KeyS') || this.keysHeld.has('ArrowDown')) moveZ += 1;

      const input: InputSnapshot = {
        moveX: Math.max(-1, Math.min(1, moveX)),
        moveZ: Math.max(-1, Math.min(1, moveZ)),
        cameraYaw: this.cameraYaw,
        jumpHeld: this.keysHeld.has('Space'),
        jumpJustPressed: this.justJump,
        dashJustPressed: this.justDash,
        strikeJustPressed: this.justStrike,
      };
      this.justJump = false;
      this.justDash = false;
      this.justStrike = false;

      const events = stepSimulation(this.sim, dt, input);
      if (events.length > 0) {
        this.handleSimEventsVisuals(events);
        this.callbacks.onSimEvents(events);
      }

      if (this.sim.player.hp <= 0 && !this.defeatTriggered) {
        this.defeatTriggered = true;
        this.callbacks.onPlayerDefeated();
      }
    }

    // Sync player 3D model with stride bob, squash-and-stretch, and hit flash
    const p = this.sim.player;
    this.playerVisual.group.position.set(p.x, p.y, p.z);
    this.playerVisual.bodyGroup.rotation.y = p.rotY;
    const strideBob = p.grounded ? Math.abs(Math.sin(p.walkDistance * 2.4)) * 0.12 : 0;
    this.playerVisual.bodyGroup.position.y = strideBob;
    const invSq = 1 / Math.sqrt(Math.max(0.5, p.squashY));
    this.playerVisual.bodyGroup.scale.set(invSq, p.squashY, invSq);
    this.playerVisual.lanternCrystal.rotation.y += dt * 2.4;

    const pFlash = p.hitFlashTimer > 0 ? 1.5 : 0;
    for (const mat of this.playerVisual.hitMaterials) {
      mat.emissive.setHex(pFlash > 0 ? 0xff4c4c : 0x000000);
      mat.emissiveIntensity = pFlash;
    }

    // Sync enemy visuals, telegraphs, hit flashes, and KO dissolve topple
    this.syncEnemyVisuals();
    for (const enemy of this.sim.enemies) {
      const vis = this.enemyVisuals.get(enemy.id);
      if (!vis) continue;
      vis.group.position.set(enemy.x, enemy.y, enemy.z);
      vis.bodyGroup.rotation.y = enemy.rotY;

      if (enemy.state === 'ko') {
        const koRatio = Math.max(0, enemy.koTimer / 0.42);
        vis.bodyGroup.rotation.z = (1 - koRatio) * 1.45;
        vis.bodyGroup.scale.setScalar(Math.max(0.05, koRatio));
        vis.telegraphRing.visible = false;
      } else {
        vis.bodyGroup.rotation.z = 0;
        vis.bodyGroup.scale.setScalar(1);
        vis.telegraphRing.visible = enemy.state === 'telegraph';
        if (enemy.state === 'telegraph') {
          const pulse = 0.85 + Math.sin(t * 24) * 0.18;
          vis.telegraphRing.scale.setScalar(pulse);
        }
        const flash = enemy.hitFlashTimer > 0;
        for (const m of vis.coreMaterials) {
          if (flash) {
            m.emissive.setHex(0xffffff);
            m.emissiveIntensity = 1.9;
          } else if (m === vis.coreMaterials[0]) {
            m.emissive.setHex(0x000000);
            m.emissiveIntensity = 0;
          } else {
            m.emissive.setHex(
              enemy.archetype === 'weaver'
                ? 0xff3b6b
                : enemy.archetype === 'golem'
                  ? 0xff6e1a
                  : 0xff4c29
            );
            m.emissiveIntensity = 1.65;
          }
        }
      }
    }

    // Sync projectiles & remote multiplayer wayfarers
    this.syncProjectiles();
    const remoteDamp = 1 - Math.exp(-8 * dt);
    for (const rVis of this.remoteVisuals.values()) {
      rVis.group.position.x += (rVis.targetX - rVis.group.position.x) * remoteDamp;
      rVis.group.position.y += (rVis.targetY - rVis.group.position.y) * remoteDamp;
      rVis.group.position.z += (rVis.targetZ - rVis.group.position.z) * remoteDamp;
      rVis.bodyGroup.rotation.y = rVis.targetRotY;
      rVis.lanternCrystal.rotation.y += dt * 2;
    }

    // Damped 3rd-person follow camera + trauma shake + dash FOV kick
    const camDist = 11.5;
    const horizDist = camDist * Math.cos(this.cameraPitch);
    const desiredX = p.x + Math.sin(this.cameraYaw) * horizDist;
    const desiredZ = p.z + Math.cos(this.cameraYaw) * horizDist;
    const desiredFloor = groundHeightAt(desiredX, desiredZ, this.sim.seedOffset);
    const desiredY = Math.max(
      desiredFloor + 1.8,
      p.y + 2.6 + camDist * Math.sin(this.cameraPitch)
    );

    const camDamp = 1 - Math.exp(-9 * dt);
    this.currentCamPos.x += (desiredX - this.currentCamPos.x) * camDamp;
    this.currentCamPos.y += (desiredY - this.currentCamPos.y) * camDamp;
    this.currentCamPos.z += (desiredZ - this.currentCamPos.z) * camDamp;

    const targetLookY = p.y + 1.85;
    this.currentLookAt.x += (p.x - this.currentLookAt.x) * camDamp;
    this.currentLookAt.y += (targetLookY - this.currentLookAt.y) * camDamp;
    this.currentLookAt.z += (p.z - this.currentLookAt.z) * camDamp;

    // Trauma-squared rotational/offset shake
    const shake = this.sim.cameraTrauma * this.sim.cameraTrauma * 0.55;
    const shakeX = (Math.random() - 0.5) * shake;
    const shakeY = (Math.random() - 0.5) * shake;
    this.camera.position.set(
      this.currentCamPos.x + shakeX,
      this.currentCamPos.y + shakeY,
      this.currentCamPos.z
    );
    this.camera.lookAt(this.currentLookAt);

    // Subtle FOV kick while dashing
    const targetFov = p.dashTimer > 0 ? 63 : 56;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-10 * dt));
      this.camera.updateProjectionMatrix();
    }

    // Update particles
    this.updateParticles(dt * animScale);

    // Throttled HUD snapshot emit (<= 8Hz so React never reconciles at 60Hz)
    this.hudEmitAccum += dt;
    if (this.hudEmitAccum >= 0.125) {
      this.hudEmitAccum = 0;
      const nearest = findNearestShrine(p.x, p.z, this.sim.shrines);
      const threat = computeThreatLevel(p, this.sim.enemies);
      this.callbacks.onHudUpdate({
        hp: Math.round(p.hp),
        maxHp: Math.round(p.maxHp),
        resonance: Math.round(p.resonance),
        shards: Math.round(p.shards),
        level: p.level,
        defeatedCount: p.defeatedCount,
        stability: 0, // populated by App from WorldState
        biomeName: BIOME_PALETTES[this.biomeKey].name,
        nearestShrine: nearest
          ? { ...nearest, distance: Number(nearest.distance.toFixed(1)) }
          : null,
        activeEnemyThreat: threat,
        playerX: Math.round(p.x),
        playerZ: Math.round(p.z),
        dashReady: p.dashCooldown <= 0 && p.resonance >= 22,
        strikeReady: p.strikeCooldown <= 0 && p.resonance >= 14,
      });
    }
  }

  private handleSimEventsVisuals(events: SimEvent[]): void {
    for (const ev of events) {
      if (ev.type === 'jump' || ev.type === 'land') {
        this.spawnParticleBurst(ev.x, ev.y + 0.1, ev.z, 5, 0xd8c6a2, 2.8);
      } else if (ev.type === 'dash') {
        this.spawnParticleBurst(ev.x, ev.y, ev.z, 10, 0x6dd6f5, 5.2);
      } else if (ev.type === 'strike') {
        this.spawnParticleBurst(ev.x, ev.y, ev.z, 12, 0xf6c56c, 6.4);
      } else if (ev.type === 'enemy_hit') {
        this.spawnParticleBurst(ev.x, ev.y, ev.z, 14, 0xff9a4d, 7.2);
      } else if (ev.type === 'enemy_ko') {
        this.spawnParticleBurst(ev.x, ev.y, ev.z, 26, 0xff5a3d, 9.5);
      } else if (ev.type === 'player_hurt') {
        this.spawnParticleBurst(ev.x, ev.y, ev.z, 18, 0xff3b5c, 7.8);
      }
    }
  }

  private updateParticles(dt: number): void {
    if (dt <= 0) return;
    for (let i = 0; i < this.particleCount; i++) {
      const pt = this.particles[i];
      if (!pt.active) {
        _mat4.makeScale(0, 0, 0);
        this.particleMesh.setMatrixAt(i, _mat4);
        continue;
      }

      pt.life -= dt;
      if (i < 36) {
        // Wrap ambient highland motes continuously
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.z += pt.vz * dt;
        if (pt.y > 10 || pt.life <= 0) {
          const angle = Math.random() * Math.PI * 2;
          const r = 3 + Math.random() * 34;
          pt.x = Math.cos(angle) * r;
          pt.y = 0.6;
          pt.z = Math.sin(angle) * r;
          pt.life = 8 + Math.random() * 6;
        }
        const s = pt.size;
        _vec3A.set(pt.x, pt.y, pt.z);
        _quat.identity();
        _scaleVec.set(s, s, s);
        _mat4.compose(_vec3A, _quat, _scaleVec);
        this.particleMesh.setMatrixAt(i, _mat4);
        _color.setHex(pt.color);
        this.particleMesh.setColorAt(i, _color);
      } else {
        if (pt.life <= 0) {
          pt.active = false;
          _mat4.makeScale(0, 0, 0);
          this.particleMesh.setMatrixAt(i, _mat4);
          continue;
        }
        pt.vy -= 12 * dt;
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.z += pt.vz * dt;
        const s = pt.size * Math.max(0.05, pt.life / pt.maxLife);
        _vec3A.set(pt.x, pt.y, pt.z);
        _quat.identity();
        _scaleVec.set(s, s, s);
        _mat4.compose(_vec3A, _quat, _scaleVec);
        this.particleMesh.setMatrixAt(i, _mat4);
        _color.setHex(pt.color);
        this.particleMesh.setColorAt(i, _color);
      }
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) {
      this.particleMesh.instanceColor.needsUpdate = true;
    }
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onBlur);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);

    this.texPack.terrainColor.dispose();
    this.texPack.terrainBump.dispose();
    this.texPack.stoneBump.dispose();
    this.texPack.contactShadow.dispose();
    this.projGeo.dispose();

    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
