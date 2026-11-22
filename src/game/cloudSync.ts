import { signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  isFirebaseReady,
  OperationType,
} from '../firebase';
import type {
  BiomeKey,
  FactionId,
  NarrativeBeacon,
  PlayerSimState,
  RemoteWayfarer,
  VectorMemoryEntry,
  WorldState,
} from './types';
import { getDominantFaction } from './questEngine';
import type { VectorMemoryStore } from './vectorMemory';

export interface CloudSaveData {
  slotLabel: string;
  realmId: string;
  biomeKey: BiomeKey;
  playerX: number;
  playerZ: number;
  hp: number;
  maxHp: number;
  shards: number;
  level: number;
  stability: number;
  orderRep: number;
  verdantRep: number;
  unboundRep: number;
  completedQuests: number;
  lat: number;
  lng: number;
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || 'sanctuary-prime';
}

function sanitizeCallsign(raw: string | null | undefined): string {
  const clean = (raw || 'Wayfarer').trim().slice(0, 40);
  return clean.length >= 2 ? clean : 'Wayfarer';
}

export async function signInWithGoogle(): Promise<User> {
  if (!isFirebaseReady() || !auth) {
    throw new Error('Firebase cloud configuration is not active on this server.');
  }
  const result = await signInWithPopup(auth, googleProvider);
  const user = result.user;
  await ensureUserProfile(user);
  return user;
}

export async function signOutPlayer(): Promise<void> {
  if (!isFirebaseReady() || !auth) return;
  await signOut(auth);
}

export async function ensureUserProfile(user: User): Promise<void> {
  if (!user.emailVerified) return;
  const userPath = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        callsign: sanitizeCallsign(user.displayName),
        email: (user.email || 'unknown@example.com').slice(0, 160),
        role: 'player',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        callsign: sanitizeCallsign(user.displayName),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, userPath);
  }
}

export async function syncSaveToCloud(
  user: User,
  world: WorldState,
  player: PlayerSimState,
  memoryStore: VectorMemoryStore
): Promise<{ memoriesUploaded: number }> {
  if (!user.emailVerified) {
    throw new Error('Verified Google account required for cloud synchronization.');
  }

  await ensureUserProfile(user);

  const saveId = 'slot-primary';
  const savePath = `users/${user.uid}/saves/${saveId}`;
  const saveRef = doc(db, 'users', user.uid, 'saves', saveId);

  const payload = {
    ownerId: user.uid,
    slotLabel: `${world.realmName}`.slice(0, 64),
    realmId: sanitizeId(world.realmId),
    biomeKey: world.biomeKey,
    playerX: Math.max(-500, Math.min(500, Number(player.x.toFixed(2)))),
    playerZ: Math.max(-500, Math.min(500, Number(player.z.toFixed(2)))),
    hp: Math.max(0, Math.min(1000, Math.round(player.hp))),
    maxHp: Math.max(1, Math.min(1000, Math.round(player.maxHp))),
    shards: Math.max(0, Math.min(1000000, Math.round(player.shards))),
    level: Math.max(1, Math.min(999, Math.round(player.level))),
    stability: Math.max(0, Math.min(100, Number(world.stability.toFixed(1)))),
    orderRep: Math.max(-1000, Math.min(1000, Math.round(world.orderRep))),
    verdantRep: Math.max(-1000, Math.min(1000, Math.round(world.verdantRep))),
    unboundRep: Math.max(-1000, Math.min(1000, Math.round(world.unboundRep))),
    completedQuests: Math.max(0, Math.min(10000, Math.round(world.completedQuests))),
    lat: Math.max(-90, Math.min(90, Number(world.lat.toFixed(4)))),
    lng: Math.max(-180, Math.min(180, Number(world.lng.toFixed(4)))),
  };

  try {
    const snap = await getDoc(saveRef);
    if (!snap.exists()) {
      await setDoc(saveRef, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(saveRef, {
        slotLabel: payload.slotLabel,
        realmId: payload.realmId,
        biomeKey: payload.biomeKey,
        playerX: payload.playerX,
        playerZ: payload.playerZ,
        hp: payload.hp,
        maxHp: payload.maxHp,
        shards: payload.shards,
        level: payload.level,
        stability: payload.stability,
        orderRep: payload.orderRep,
        verdantRep: payload.verdantRep,
        unboundRep: payload.unboundRep,
        completedQuests: payload.completedQuests,
        lat: payload.lat,
        lng: payload.lng,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, savePath);
  }

  // Upload unsynced local vector memories (bounded batch of top 8 per sync)
  const unsynced = memoryStore
    .getAll()
    .filter((m) => !m.synced)
    .slice(0, 8);

  let memoriesUploaded = 0;
  for (const mem of unsynced) {
    const memId = sanitizeId(mem.id);
    const memPath = `users/${user.uid}/memories/${memId}`;
    try {
      const memRef = doc(db, 'users', user.uid, 'memories', memId);
      const existsSnap = await getDoc(memRef);
      if (!existsSnap.exists()) {
        await setDoc(memRef, {
          ownerId: user.uid,
          summary: mem.summary.slice(0, 400),
          category: mem.category,
          factionTag: mem.factionTag,
          importance: Math.max(0, Math.min(10, mem.importance)),
          embedding: mem.embedding.slice(0, 64),
          createdAt: serverTimestamp(),
        });
      }
      memoryStore.markSynced(mem.id);
      memoriesUploaded++;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, memPath);
    }
  }

  memoryStore.saveToBrowser();
  return { memoriesUploaded };
}

export async function restoreCloudSave(
  user: User,
  memoryStore: VectorMemoryStore
): Promise<{ save: CloudSaveData | null; memoriesMerged: number }> {
  if (!user.emailVerified) {
    return { save: null, memoriesMerged: 0 };
  }

  const savePath = `users/${user.uid}/saves/slot-primary`;
  let save: CloudSaveData | null = null;
  try {
    const snap = await getDoc(doc(db, 'users', user.uid, 'saves', 'slot-primary'));
    if (snap.exists()) {
      const d = snap.data();
      save = {
        slotLabel: String(d.slotLabel || 'Sanctuary'),
        realmId: String(d.realmId || 'sanctuary-prime'),
        biomeKey: d.biomeKey as BiomeKey,
        playerX: Number(d.playerX || 0),
        playerZ: Number(d.playerZ || 6),
        hp: Number(d.hp || 100),
        maxHp: Number(d.maxHp || 100),
        shards: Number(d.shards || 0),
        level: Number(d.level || 1),
        stability: Number(d.stability || 72),
        orderRep: Number(d.orderRep || 0),
        verdantRep: Number(d.verdantRep || 0),
        unboundRep: Number(d.unboundRep || 0),
        completedQuests: Number(d.completedQuests || 0),
        lat: Number(d.lat || 46.5197),
        lng: Number(d.lng || 6.6323),
      };
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, savePath);
  }

  const memPath = `users/${user.uid}/memories`;
  let memoriesMerged = 0;
  try {
    const q = query(
      collection(db, 'users', user.uid, 'memories'),
      where('ownerId', '==', user.uid)
    );
    const snap = await getDocs(q);
    const remote: VectorMemoryEntry[] = snap.docs.map((docSnap) => {
      const d = docSnap.data();
      return {
        id: docSnap.id,
        summary: String(d.summary || ''),
        category: d.category,
        factionTag: d.factionTag,
        importance: Number(d.importance || 5),
        embedding: Array.isArray(d.embedding) ? d.embedding : [1],
        createdAt: d.createdAt?.toMillis?.() ?? Date.now(),
        synced: true,
      };
    });
    memoriesMerged = memoryStore.mergeRemote(remote);
    if (memoriesMerged > 0) memoryStore.saveToBrowser();
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, memPath);
  }

  return { save, memoriesMerged };
}

export async function ensureMultiplayerRealm(
  user: User,
  world: WorldState
): Promise<string> {
  await ensureUserProfile(user);
  const realmId = sanitizeId(world.realmId);
  const realmPath = `realms/${realmId}`;
  const ref = doc(db, 'realms', realmId);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        realmId,
        realmName: world.realmName.slice(0, 80),
        biomeKey: world.biomeKey,
        lat: Number(world.lat.toFixed(4)),
        lng: Number(world.lng.toFixed(4)),
        stability: Number(world.stability.toFixed(1)),
        ownerId: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, realmPath);
  }
  return realmId;
}

export async function publishPlayerPresence(
  user: User,
  realmId: string,
  player: PlayerSimState,
  world: WorldState
): Promise<void> {
  if (!user.emailVerified) return;
  const cleanRealm = sanitizeId(realmId);
  const path = `realms/${cleanRealm}/players/${user.uid}`;
  const ref = doc(db, 'realms', cleanRealm, 'players', user.uid);

  const data = {
    uid: user.uid,
    realmId: cleanRealm,
    callsign: sanitizeCallsign(user.displayName),
    x: Math.max(-500, Math.min(500, Number(player.x.toFixed(2)))),
    y: Math.max(-100, Math.min(300, Number(player.y.toFixed(2)))),
    z: Math.max(-500, Math.min(500, Number(player.z.toFixed(2)))),
    rotY: Math.max(-100, Math.min(100, Number(player.rotY.toFixed(2)))),
    faction: getDominantFaction(world),
    shards: Math.max(0, Math.min(1000000, Math.round(player.shards))),
    updatedAt: serverTimestamp(),
  };

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, data);
    } else {
      await updateDoc(ref, {
        callsign: data.callsign,
        x: data.x,
        y: data.y,
        z: data.z,
        rotY: data.rotY,
        faction: data.faction,
        shards: data.shards,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function removePlayerPresence(user: User, realmId: string): Promise<void> {
  const cleanRealm = sanitizeId(realmId);
  const path = `realms/${cleanRealm}/players/${user.uid}`;
  try {
    await deleteDoc(doc(db, 'realms', cleanRealm, 'players', user.uid));
  } catch {
    // Best-effort cleanup on disconnect
  }
}

export async function plantNarrativeBeacon(
  user: User,
  realmId: string,
  message: string,
  x: number,
  z: number,
  faction: FactionId
): Promise<void> {
  if (!user.emailVerified) {
    throw new Error('Sign in with a verified Google account to plant a shared beacon.');
  }
  await ensureUserProfile(user);
  const cleanRealm = sanitizeId(realmId);
  const beaconId = `bcn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const path = `realms/${cleanRealm}/beacons/${beaconId}`;
  const cleanMsg = message.trim().slice(0, 180);
  if (cleanMsg.length < 3) {
    throw new Error('Beacon message must be at least 3 characters.');
  }

  try {
    await setDoc(doc(db, 'realms', cleanRealm, 'beacons', beaconId), {
      authorId: user.uid,
      realmId: cleanRealm,
      callsign: sanitizeCallsign(user.displayName),
      message: cleanMsg,
      faction,
      x: Math.max(-500, Math.min(500, Number(x.toFixed(2)))),
      z: Math.max(-500, Math.min(500, Number(z.toFixed(2)))),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export function subscribeToRealmMultiplayer(
  user: User,
  realmId: string,
  onPlayers: (players: RemoteWayfarer[]) => void,
  onBeacons: (beacons: NarrativeBeacon[]) => void
): Unsubscribe {
  const cleanRealm = sanitizeId(realmId);
  const playersPath = `realms/${cleanRealm}/players`;
  const beaconsPath = `realms/${cleanRealm}/beacons`;

  const playersQuery = query(
    collection(db, 'realms', cleanRealm, 'players'),
    where('realmId', '==', cleanRealm)
  );
  const unsubPlayers = onSnapshot(
    playersQuery,
    (snap) => {
      const list: RemoteWayfarer[] = [];
      for (const docSnap of snap.docs) {
        if (docSnap.id === user.uid) continue;
        const d = docSnap.data();
        list.push({
          uid: docSnap.id,
          callsign: String(d.callsign || 'Wayfarer'),
          x: Number(d.x || 0),
          y: Number(d.y || 0),
          z: Number(d.z || 0),
          rotY: Number(d.rotY || 0),
          faction: (d.faction as FactionId) || 'neutral',
          shards: Number(d.shards || 0),
          updatedAt: d.updatedAt?.toMillis?.() ?? Date.now(),
        });
      }
      onPlayers(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, playersPath);
    }
  );

  const beaconsQuery = query(
    collection(db, 'realms', cleanRealm, 'beacons'),
    where('realmId', '==', cleanRealm)
  );
  const unsubBeacons = onSnapshot(
    beaconsQuery,
    (snap) => {
      const list: NarrativeBeacon[] = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          authorId: String(d.authorId || ''),
          callsign: String(d.callsign || 'Wayfarer'),
          message: String(d.message || ''),
          faction: (d.faction as FactionId) || 'neutral',
          x: Number(d.x || 0),
          z: Number(d.z || 0),
          createdAt: d.createdAt?.toMillis?.() ?? Date.now(),
        };
      });
      onBeacons(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, beaconsPath);
    }
  );

  return () => {
    unsubPlayers();
    unsubBeacons();
  };
}
