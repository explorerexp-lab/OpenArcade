import * as THREE from 'three';
import type { BiomePalette, EnemyArchetype, ShrineNode } from './types';

export interface ProceduralTexturePack {
  terrainColor: THREE.CanvasTexture;
  terrainBump: THREE.CanvasTexture;
  stoneBump: THREE.CanvasTexture;
  contactShadow: THREE.CanvasTexture;
}

export function createProceduralTextures(
  palette: BiomePalette,
  maxAnisotropy: number
): ProceduralTexturePack {
  // 1. Tileable organic terrain albedo + bump map
  const tSize = 256;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = tSize;
  colorCanvas.height = tSize;
  const cCtx = colorCanvas.getContext('2d')!;
  cCtx.fillStyle = palette.terrainPrimary;
  cCtx.fillRect(0, 0, tSize, tSize);

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = tSize;
  bumpCanvas.height = tSize;
  const bCtx = bumpCanvas.getContext('2d')!;
  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, tSize, tSize);

  // Layered painterly ground grain & pebbles
  let seed = Math.round(palette.seedOffset * 1337) + 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let i = 0; i < 650; i++) {
    const x = rand() * tSize;
    const y = rand() * tSize;
    const r = 2 + rand() * 14;
    cCtx.fillStyle = rand() > 0.45 ? palette.terrainSecondary : palette.terrainPrimary;
    cCtx.globalAlpha = 0.16 + rand() * 0.2;
    cCtx.beginPath();
    cCtx.arc(x, y, r, 0, Math.PI * 2);
    cCtx.fill();

    const gVal = Math.round(95 + rand() * 85);
    bCtx.fillStyle = `rgb(${gVal},${gVal},${gVal})`;
    bCtx.globalAlpha = 0.25;
    bCtx.beginPath();
    bCtx.arc(x, y, r * 0.75, 0, Math.PI * 2);
    bCtx.fill();
  }
  cCtx.globalAlpha = 1;
  bCtx.globalAlpha = 1;

  const terrainColor = new THREE.CanvasTexture(colorCanvas);
  terrainColor.colorSpace = THREE.SRGBColorSpace;
  terrainColor.wrapS = THREE.RepeatWrapping;
  terrainColor.wrapT = THREE.RepeatWrapping;
  terrainColor.repeat.set(16, 16);
  terrainColor.anisotropy = maxAnisotropy;

  const terrainBump = new THREE.CanvasTexture(bumpCanvas);
  terrainBump.wrapS = THREE.RepeatWrapping;
  terrainBump.wrapT = THREE.RepeatWrapping;
  terrainBump.repeat.set(16, 16);
  terrainBump.anisotropy = maxAnisotropy;

  // 2. Carved runic stonework bump map
  const sCanvas = document.createElement('canvas');
  sCanvas.width = 256;
  sCanvas.height = 256;
  const sCtx = sCanvas.getContext('2d')!;
  sCtx.fillStyle = '#808080';
  sCtx.fillRect(0, 0, 256, 256);
  sCtx.strokeStyle = '#383838';
  sCtx.lineWidth = 3;
  for (let y = 0; y < 256; y += 32) {
    sCtx.beginPath();
    sCtx.moveTo(0, y);
    sCtx.lineTo(256, y);
    sCtx.stroke();
    const offset = (y / 32) % 2 === 0 ? 0 : 32;
    for (let x = offset; x < 256; x += 64) {
      sCtx.beginPath();
      sCtx.moveTo(x, y);
      sCtx.lineTo(x, y + 32);
      sCtx.stroke();
    }
  }
  // Subtle geometric glyph inlays
  sCtx.strokeStyle = '#c8c8c8';
  sCtx.lineWidth = 2;
  for (let i = 0; i < 16; i++) {
    const gx = 20 + (i % 4) * 64;
    const gy = 16 + Math.floor(i / 4) * 64;
    sCtx.strokeRect(gx, gy, 24, 18);
  }
  const stoneBump = new THREE.CanvasTexture(sCanvas);
  stoneBump.wrapS = THREE.RepeatWrapping;
  stoneBump.wrapT = THREE.RepeatWrapping;
  stoneBump.repeat.set(2, 2);
  stoneBump.anisotropy = maxAnisotropy;

  // 3. Soft radial contact shadow texture
  const shCanvas = document.createElement('canvas');
  shCanvas.width = 128;
  shCanvas.height = 128;
  const shCtx = shCanvas.getContext('2d')!;
  const grad = shCtx.createRadialGradient(64, 64, 6, 64, 64, 60);
  grad.addColorStop(0, 'rgba(6, 9, 14, 0.72)');
  grad.addColorStop(0.55, 'rgba(6, 9, 14, 0.34)');
  grad.addColorStop(1, 'rgba(6, 9, 14, 0.0)');
  shCtx.fillStyle = grad;
  shCtx.fillRect(0, 0, 128, 128);
  const contactShadow = new THREE.CanvasTexture(shCanvas);

  return { terrainColor, terrainBump, stoneBump, contactShadow };
}

export function createContactShadowDisc(
  shadowTex: THREE.CanvasTexture,
  radius: number
): THREE.Mesh {
  const geo = new THREE.CircleGeometry(radius, 24);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.03;
  return mesh;
}

/**
 * 9-part composite Hero Wayfarer model pivoted strictly at bottom-center (y = 0).
 * Distinct roughness/metalness contrast between matte woven cloak, satin leather cuirass,
 * brushed brass trim, and glowing crystal lantern staff.
 */
export function buildWayfarerModel(
  accentHex: number,
  shadowTex: THREE.CanvasTexture,
  isRemote = false
): {
  group: THREE.Group;
  bodyGroup: THREE.Group;
  lanternCrystal: THREE.Mesh;
  hitMaterials: THREE.MeshStandardMaterial[];
} {
  const group = new THREE.Group();
  const bodyGroup = new THREE.Group();
  group.add(bodyGroup);

  const cloakMat = new THREE.MeshStandardMaterial({
    color: isRemote ? 0x2c4b5c : 0x243447,
    roughness: 0.84,
    metalness: 0.05,
  });
  const cuirassMat = new THREE.MeshStandardMaterial({
    color: 0x3f4954,
    roughness: 0.45,
    metalness: 0.52,
  });
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xd4a459,
    roughness: 0.24,
    metalness: 0.88,
  });
  const bootMat = new THREE.MeshStandardMaterial({
    color: 0x1e1d20,
    roughness: 0.78,
    metalness: 0.1,
  });
  const crystalMat = new THREE.MeshStandardMaterial({
    color: accentHex,
    emissive: accentHex,
    emissiveIntensity: 1.4,
    roughness: 0.12,
    metalness: 0.2,
  });

  // 1 & 2. Grounded boots
  const bootGeo = new THREE.CapsuleGeometry(0.14, 0.22, 6, 10);
  const leftBoot = new THREE.Mesh(bootGeo, bootMat);
  leftBoot.position.set(-0.2, 0.24, 0);
  leftBoot.castShadow = true;
  const rightBoot = new THREE.Mesh(bootGeo, bootMat);
  rightBoot.position.set(0.2, 0.24, 0);
  rightBoot.castShadow = true;
  bodyGroup.add(leftBoot, rightBoot);

  // 3. Sculpted LatheGeometry layered wayfarer cloak
  const cloakPts = [
    new THREE.Vector2(0.56, 0.18),
    new THREE.Vector2(0.46, 0.72),
    new THREE.Vector2(0.36, 1.24),
    new THREE.Vector2(0.28, 1.48),
  ];
  const cloakGeo = new THREE.LatheGeometry(cloakPts, 18);
  const cloak = new THREE.Mesh(cloakGeo, cloakMat);
  cloak.castShadow = true;
  cloak.receiveShadow = true;
  bodyGroup.add(cloak);

  // 4. Beveled torso cuirass plate
  const chestGeo = new THREE.CylinderGeometry(0.3, 0.35, 0.56, 10);
  const chest = new THREE.Mesh(chestGeo, cuirassMat);
  chest.position.y = 1.18;
  chest.castShadow = true;
  bodyGroup.add(chest);

  // 5 & 6. Shoulder pauldrons (metallic brass trim)
  const pauldronGeo = new THREE.SphereGeometry(0.21, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.6);
  const leftPauldron = new THREE.Mesh(pauldronGeo, brassMat);
  leftPauldron.position.set(-0.36, 1.44, 0);
  leftPauldron.rotation.z = 0.45;
  leftPauldron.castShadow = true;
  const rightPauldron = new THREE.Mesh(pauldronGeo, brassMat);
  rightPauldron.position.set(0.36, 1.44, 0);
  rightPauldron.rotation.z = -0.45;
  rightPauldron.castShadow = true;
  bodyGroup.add(leftPauldron, rightPauldron);

  // 7. Hooded head + brass astrolabe visor
  const headGroup = new THREE.Group();
  headGroup.position.y = 1.72;
  const hood = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.46, 12), cloakMat);
  hood.position.y = 0.06;
  hood.castShadow = true;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.18), crystalMat);
  visor.position.set(0, -0.02, 0.16);
  const crownRing = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.028, 8, 20), brassMat);
  crownRing.rotation.x = Math.PI / 2;
  crownRing.position.y = 0.08;
  headGroup.add(hood, visor, crownRing);
  bodyGroup.add(headGroup);

  // 8 & 9. Curved TubeGeometry Relic Staff + floating crystal lantern
  const staffCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.55, 0.16, 0.1),
    new THREE.Vector3(0.58, 1.15, 0.18),
    new THREE.Vector3(0.62, 1.92, 0.34),
    new THREE.Vector3(0.46, 2.08, 0.44),
  ]);
  const staffGeo = new THREE.TubeGeometry(staffCurve, 16, 0.036, 8, false);
  const staffMesh = new THREE.Mesh(staffGeo, brassMat);
  staffMesh.castShadow = true;
  bodyGroup.add(staffMesh);

  const lanternCrystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), crystalMat);
  lanternCrystal.position.set(0.46, 1.88, 0.44);
  const lanternHalo = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.018, 8, 20), brassMat);
  lanternHalo.position.copy(lanternCrystal.position);
  bodyGroup.add(lanternCrystal, lanternHalo);

  // Grounded radial contact shadow
  group.add(createContactShadowDisc(shadowTex, 0.85));

  return {
    group,
    bodyGroup,
    lanternCrystal,
    hitMaterials: [cloakMat, cuirassMat],
  };
}

/**
 * 8-part monumental Resonance Shrine Obelisk with counter-rotating bronze astrolabe rings,
 * stepped basalt plinth, glowing crystal core, and flanking braziers.
 */
export function buildShrineMonolith(
  shrine: ShrineNode,
  stoneBump: THREE.CanvasTexture,
  shadowTex: THREE.CanvasTexture
): {
  group: THREE.Group;
  outerRing: THREE.Mesh;
  innerRing: THREE.Mesh;
  coreCrystal: THREE.Mesh;
  coreMat: THREE.MeshStandardMaterial;
} {
  const group = new THREE.Group();

  const plinthMat = new THREE.MeshStandardMaterial({
    color: 0x4b5159,
    roughness: 0.82,
    metalness: 0.12,
    bumpMap: stoneBump,
    bumpScale: 0.05,
  });
  const pillarMat = new THREE.MeshStandardMaterial({
    color: 0x9b9587,
    roughness: 0.72,
    metalness: 0.08,
    bumpMap: stoneBump,
    bumpScale: 0.06,
  });
  const bronzeMat = new THREE.MeshStandardMaterial({
    color: 0xc9964c,
    roughness: 0.22,
    metalness: 0.9,
  });
  const coreMat = new THREE.MeshStandardMaterial({
    color: shrine.color,
    emissive: shrine.color,
    emissiveIntensity: 1.4,
    roughness: 0.14,
    metalness: 0.25,
  });

  // 1 & 2. Two-tier stepped octagonal stone plinth
  const base1 = new THREE.Mesh(new THREE.CylinderGeometry(2.35, 2.65, 0.45, 8), plinthMat);
  base1.position.y = 0.225;
  base1.castShadow = true;
  base1.receiveShadow = true;

  const base2 = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 2.0, 0.45, 8), plinthMat);
  base2.position.y = 0.675;
  base2.castShadow = true;
  base2.receiveShadow = true;
  group.add(base1, base2);

  // 3. Tapered split monolith columns framing the astrolabe void
  const colGeo = new THREE.BoxGeometry(0.65, 5.4, 0.65);
  const colLeft = new THREE.Mesh(colGeo, pillarMat);
  colLeft.position.set(-1.12, 3.55, 0);
  colLeft.rotation.z = -0.06;
  colLeft.castShadow = true;
  colLeft.receiveShadow = true;

  const colRight = new THREE.Mesh(colGeo, pillarMat);
  colRight.position.set(1.12, 3.55, 0);
  colRight.rotation.z = 0.06;
  colRight.castShadow = true;
  colRight.receiveShadow = true;

  // 4. Crown lintel arch cap
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.65, 0.55, 8), bronzeMat);
  crown.position.y = 6.45;
  crown.castShadow = true;
  group.add(colLeft, colRight, crown);

  // 5 & 6. Counter-rotating bronze astrolabe rings
  const outerRing = new THREE.Mesh(new THREE.TorusGeometry(1.65, 0.09, 12, 36), bronzeMat);
  outerRing.position.y = 4.2;
  outerRing.castShadow = true;

  const innerRing = new THREE.Mesh(new THREE.TorusGeometry(1.18, 0.065, 10, 28), bronzeMat);
  innerRing.position.y = 4.2;
  group.add(outerRing, innerRing);

  // 7. Floating Resonance Crystal Core
  const coreCrystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.58, 0), coreMat);
  coreCrystal.position.y = 4.2;
  group.add(coreCrystal);

  // 8. Three grounded perimeter brazier bollards
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const bx = Math.cos(angle) * 2.15;
    const bz = Math.sin(angle) * 2.15;
    const brazier = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 1.05, 6), plinthMat);
    brazier.position.set(bx, 0.525, bz);
    brazier.castShadow = true;
    const ember = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), coreMat);
    ember.position.set(bx, 1.18, bz);
    group.add(brazier, ember);
  }

  group.add(createContactShadowDisc(shadowTex, 3.1));

  return { group, outerRing, innerRing, coreCrystal, coreMat };
}

/**
 * 3 distinct composite enemy archetype assemblies (6–8 parts each) + ground attack telegraph ring.
 */
export function buildEnemyModel(
  archetype: EnemyArchetype,
  shadowTex: THREE.CanvasTexture
): {
  group: THREE.Group;
  bodyGroup: THREE.Group;
  telegraphRing: THREE.Mesh;
  coreMaterials: THREE.MeshStandardMaterial[];
} {
  const group = new THREE.Group();
  const bodyGroup = new THREE.Group();
  group.add(bodyGroup);

  const coreMaterials: THREE.MeshStandardMaterial[] = [];

  if (archetype === 'stalker') {
    // 7-part agile obsidian hound-construct with amber visor
    const hullMat = new THREE.MeshStandardMaterial({
      color: 0x262933,
      roughness: 0.52,
      metalness: 0.45,
    });
    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0x8f98a6,
      roughness: 0.22,
      metalness: 0.88,
    });
    const glowMat = new THREE.MeshStandardMaterial({
      color: 0xff6b4a,
      emissive: 0xff4c29,
      emissiveIntensity: 1.6,
      roughness: 0.15,
    });
    coreMaterials.push(hullMat, glowMat);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.52, 1.35), hullMat);
    torso.position.y = 0.88;
    torso.castShadow = true;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.65, 5), hullMat);
    head.rotation.x = Math.PI / 2;
    head.position.set(0, 1.04, 0.86);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.15), glowMat);
    visor.position.set(0, 1.06, 0.94);
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 0.95), bladeMat);
    spine.position.set(0, 1.24, -0.05);

    const legGeo = new THREE.CylinderGeometry(0.08, 0.05, 0.78, 6);
    const legOffsets: Array<[number, number]> = [
      [-0.36, 0.46],
      [0.36, 0.46],
      [-0.36, -0.46],
      [0.36, -0.46],
    ];
    for (const [lx, lz] of legOffsets) {
      const leg = new THREE.Mesh(legGeo, bladeMat);
      leg.position.set(lx, 0.42, lz);
      leg.castShadow = true;
      bodyGroup.add(leg);
    }
    bodyGroup.add(torso, head, visor, spine);
    group.add(createContactShadowDisc(shadowTex, 0.95));
  } else if (archetype === 'weaver') {
    // 6-part hovering brass-and-slate prism sentinel
    const slateMat = new THREE.MeshStandardMaterial({
      color: 0x354254,
      roughness: 0.42,
      metalness: 0.62,
    });
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xd9a857,
      roughness: 0.2,
      metalness: 0.92,
    });
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0xff4f7b,
      emissive: 0xff3b6b,
      emissiveIntensity: 1.8,
      roughness: 0.1,
    });
    coreMaterials.push(slateMat, eyeMat);

    const upperCrown = new THREE.Mesh(new THREE.ConeGeometry(0.52, 0.72, 6), slateMat);
    upperCrown.position.y = 2.15;
    upperCrown.castShadow = true;
    const lowerCrown = new THREE.Mesh(new THREE.ConeGeometry(0.48, 0.68, 6), slateMat);
    lowerCrown.rotation.x = Math.PI;
    lowerCrown.position.y = 1.18;
    const eye = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), eyeMat);
    eye.position.y = 1.66;
    const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.045, 8, 24), goldMat);
    ring1.position.y = 1.66;
    ring1.rotation.x = Math.PI / 3;
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.038, 8, 24), goldMat);
    ring2.position.y = 1.66;
    ring2.rotation.y = Math.PI / 4;
    bodyGroup.add(upperCrown, lowerCrown, eye, ring1, ring2);
    group.add(createContactShadowDisc(shadowTex, 0.85));
  } else {
    // 8-part Bastion Golem heavy limestone & copper colossus
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0x5d5a54,
      roughness: 0.84,
      metalness: 0.14,
    });
    const copperMat = new THREE.MeshStandardMaterial({
      color: 0xb86f42,
      roughness: 0.3,
      metalness: 0.82,
    });
    const furnaceMat = new THREE.MeshStandardMaterial({
      color: 0xff8c3b,
      emissive: 0xff6e1a,
      emissiveIntensity: 1.7,
      roughness: 0.18,
    });
    coreMaterials.push(stoneMat, furnaceMat);

    const legsGeo = new THREE.BoxGeometry(0.55, 1.05, 0.62);
    const lLeg = new THREE.Mesh(legsGeo, stoneMat);
    lLeg.position.set(-0.52, 0.525, 0);
    lLeg.castShadow = true;
    const rLeg = new THREE.Mesh(legsGeo, stoneMat);
    rLeg.position.set(0.52, 0.525, 0);
    rLeg.castShadow = true;

    const chest = new THREE.Mesh(new THREE.BoxGeometry(1.75, 1.35, 1.12), stoneMat);
    chest.position.y = 1.65;
    chest.castShadow = true;

    const furnace = new THREE.Mesh(new THREE.OctahedronGeometry(0.36, 0), furnaceMat);
    furnace.position.set(0, 1.68, 0.56);

    const crest = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 0.45, 6), copperMat);
    crest.position.y = 2.52;

    const armGeo = new THREE.BoxGeometry(0.48, 1.25, 0.56);
    const lArm = new THREE.Mesh(armGeo, copperMat);
    lArm.position.set(-1.18, 1.48, 0.1);
    lArm.castShadow = true;
    const rArm = new THREE.Mesh(armGeo, copperMat);
    rArm.position.set(1.18, 1.48, 0.1);
    rArm.castShadow = true;

    bodyGroup.add(lLeg, rLeg, chest, furnace, crest, lArm, rArm);
    group.add(createContactShadowDisc(shadowTex, 1.45));
  }

  // Visible ground telegraph ring for windup attacks
  const ringRadius = archetype === 'golem' ? 4.3 : archetype === 'stalker' ? 1.85 : 1.4;
  const teleGeo = new THREE.RingGeometry(ringRadius - 0.16, ringRadius, 32);
  teleGeo.rotateX(-Math.PI / 2);
  const teleMat = new THREE.MeshBasicMaterial({
    color: 0xff4c4c,
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const telegraphRing = new THREE.Mesh(teleGeo, teleMat);
  telegraphRing.position.y = 0.06;
  telegraphRing.visible = false;
  group.add(telegraphRing);

  return { group, bodyGroup, telegraphRing, coreMaterials };
}

export function buildBeaconModel(factionColor: number, shadowTex: THREE.CanvasTexture): THREE.Group {
  const group = new THREE.Group();
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x4c525e,
    roughness: 0.76,
    metalness: 0.18,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0xd4a459,
    roughness: 0.25,
    metalness: 0.85,
  });
  const crystalMat = new THREE.MeshStandardMaterial({
    color: factionColor,
    emissive: factionColor,
    emissiveIntensity: 1.5,
    roughness: 0.15,
  });

  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.62, 0.35, 6), baseMat);
  plinth.position.y = 0.175;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.45, 6), trimMat);
  shaft.position.y = 0.95;
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), crystalMat);
  crystal.position.y = 1.92;
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.025, 8, 20), trimMat);
  halo.position.y = 1.92;
  halo.rotation.x = Math.PI / 2;

  group.add(plinth, shaft, crystal, halo, createContactShadowDisc(shadowTex, 0.75));
  return group;
}
