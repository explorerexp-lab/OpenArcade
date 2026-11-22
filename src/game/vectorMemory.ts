import type {
  FactionId,
  MemoryCategory,
  RetrievedMemory,
  VectorMemoryEntry,
} from './types';

export const VECTOR_DIM = 64;
const LOCAL_STORAGE_KEY = 'aethern_vector_memory_v1';
const MAX_LOCAL_MEMORIES = 120;

const SEMANTIC_CLUSTERS: Record<string, number[]> = {
  // Faction & ideology concept anchors for deterministic semantic geometry
  order: [0, 4, 8, 12],
  astrolabe: [0, 4, 9, 13],
  law: [0, 5, 8, 14],
  clockwork: [1, 4, 9, 12],
  verdant: [16, 20, 24, 28],
  forest: [16, 21, 24, 29],
  growth: [17, 20, 25, 28],
  nature: [16, 20, 26, 30],
  unbound: [32, 36, 40, 44],
  storm: [32, 37, 40, 45],
  freedom: [33, 36, 41, 44],
  shard: [48, 52, 56, 60],
  relic: [48, 53, 56, 61],
  shrine: [49, 52, 57, 60],
  sentinel: [10, 22, 38, 54],
  combat: [10, 23, 39, 55],
  mercy: [18, 26, 34, 58],
  sacrifice: [6, 19, 42, 62],
  atlas: [2, 15, 31, 47],
};

function fnv1aHash(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Generates a deterministic 64-dimensional L2-normalized semantic vector locally on-device.
 * Combines concept-cluster projections with hashed word unigrams and character trigrams
 * so semantically related narratives, choices, and world events cluster cleanly in vector space.
 */
export function embedTextLocal(text: string): number[] {
  const vec = new Float64Array(VECTOR_DIM);
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
  const tokens = normalized.split(/\s+/).filter((t) => t.length >= 2);

  if (tokens.length === 0) {
    vec[0] = 1;
    return Array.from(vec);
  }

  for (const token of tokens) {
    // 1. Concept cluster boost for core narrative themes
    const cluster = SEMANTIC_CLUSTERS[token];
    if (cluster) {
      for (const dim of cluster) {
        vec[dim] += 1.65;
      }
    }

    // 2. Signed feature-hashing for exact word match
    const h1 = fnv1aHash(`w:${token}`);
    const dim1 = h1 % VECTOR_DIM;
    const sign1 = (h1 & 1) === 0 ? 1 : -1;
    vec[dim1] += sign1 * 1.1;

    // 3. Character trigram hashing for morphological similarity
    if (token.length >= 3) {
      for (let i = 0; i <= token.length - 3; i++) {
        const tri = token.slice(i, i + 3);
        const h2 = fnv1aHash(`t:${tri}`);
        const dim2 = h2 % VECTOR_DIM;
        const sign2 = (h2 & 1) === 0 ? 1 : -1;
        vec[dim2] += sign2 * 0.35;
      }
    }
  }

  return normalizeVector(Array.from(vec));
}

/**
 * Projects an arbitrary-length external embedding (e.g., gemini-embedding-2)
 * cleanly down to 64 dimensions and L2-normalizes it so Firestore bounds & local math stay aligned.
 */
export function compressAndNormalizeEmbedding(raw: number[]): number[] {
  if (!raw || raw.length === 0) {
    const fallback = new Array<number>(VECTOR_DIM).fill(0);
    fallback[0] = 1;
    return fallback;
  }
  const out = new Array<number>(VECTOR_DIM).fill(0);
  for (let i = 0; i < raw.length; i++) {
    out[i % VECTOR_DIM] += raw[i];
  }
  return normalizeVector(out);
}

export function normalizeVector(vec: number[]): number[] {
  let normSq = 0;
  for (let i = 0; i < vec.length; i++) {
    normSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(normSq);
  if (norm < 1e-9) {
    const unit = new Array<number>(vec.length).fill(0);
    if (unit.length > 0) unit[0] = 1;
    return unit;
  }
  return vec.map((v) => Number((v / norm).toFixed(5)));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom < 1e-9) return 0;
  return dot / denom;
}

export class VectorMemoryStore {
  private entries: VectorMemoryEntry[] = [];

  constructor(initialEntries?: VectorMemoryEntry[]) {
    if (initialEntries && initialEntries.length > 0) {
      this.entries = initialEntries.slice(0, MAX_LOCAL_MEMORIES);
    } else {
      this.seedGenesisMemories();
    }
  }

  private seedGenesisMemories(): void {
    const seeds: Array<{
      id: string;
      summary: string;
      category: MemoryCategory;
      factionTag: FactionId;
      importance: number;
    }> = [
      {
        id: 'mem-genesis-astrolabe',
        summary:
          'Awakened beneath the Sunken Astrolabe of Aethern as golden mist fractured the outer highland spires.',
        category: 'discovery',
        factionTag: 'order',
        importance: 7,
      },
      {
        id: 'mem-genesis-roots',
        summary:
          'Ancient cypress roots pulse with verdant resonance beneath the stone plaza, resisting clockwork containment.',
        category: 'discovery',
        factionTag: 'verdant',
        importance: 6,
      },
      {
        id: 'mem-genesis-storm',
        summary:
          'Unbound shards drift along the eastern ridge, drawing vigilant obsidian sentinels toward the monoliths.',
        category: 'discovery',
        factionTag: 'unbound',
        importance: 6,
      },
    ];

    const baseTime = Date.now() - 60000;
    this.entries = seeds.map((s, idx) => ({
      ...s,
      embedding: embedTextLocal(s.summary),
      createdAt: baseTime + idx * 1000,
      synced: false,
    }));
  }

  public addMemory(params: {
    summary: string;
    category: MemoryCategory;
    factionTag: FactionId;
    importance: number;
    customEmbedding?: number[];
  }): VectorMemoryEntry {
    const cleanSummary = params.summary.trim().slice(0, 400);
    const embedding = params.customEmbedding
      ? compressAndNormalizeEmbedding(params.customEmbedding)
      : embedTextLocal(`${params.factionTag} ${params.category} ${cleanSummary}`);

    const entry: VectorMemoryEntry = {
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      summary: cleanSummary,
      category: params.category,
      factionTag: params.factionTag,
      importance: Math.max(1, Math.min(10, Math.round(params.importance))),
      embedding,
      createdAt: Date.now(),
      synced: false,
    };

    this.entries.unshift(entry);
    if (this.entries.length > MAX_LOCAL_MEMORIES) {
      // Keep highest-importance + most recent memories
      this.entries.sort((a, b) => b.importance * 2 + b.createdAt / 1e12 - (a.importance * 2 + a.createdAt / 1e12));
      this.entries = this.entries.slice(0, MAX_LOCAL_MEMORIES);
      this.entries.sort((a, b) => b.createdAt - a.createdAt);
    }

    return entry;
  }

  public query(queryText: string, topK = 4): RetrievedMemory[] {
    const qVec = embedTextLocal(queryText);
    const now = Date.now();

    const scored = this.entries.map((entry) => {
      const sim = cosineSimilarity(qVec, entry.embedding);
      const ageHours = Math.max(0, (now - entry.createdAt) / 3600000);
      const recencyBoost = Math.exp(-ageHours * 0.05) * 0.12;
      const importanceBoost = (entry.importance / 10) * 0.14;
      return {
        entry,
        similarity: Number((sim + recencyBoost + importanceBoost).toFixed(4)),
      };
    });

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, Math.max(1, topK));
  }

  public getAll(): VectorMemoryEntry[] {
    return [...this.entries];
  }

  public count(): number {
    return this.entries.length;
  }

  public mergeRemote(remoteEntries: VectorMemoryEntry[]): number {
    const existingIds = new Set(this.entries.map((e) => e.id));
    let added = 0;
    for (const item of remoteEntries) {
      if (!existingIds.has(item.id) && item.summary && Array.isArray(item.embedding)) {
        this.entries.push({ ...item, synced: true });
        existingIds.add(item.id);
        added++;
      }
    }
    this.entries.sort((a, b) => b.createdAt - a.createdAt);
    if (this.entries.length > MAX_LOCAL_MEMORIES) {
      this.entries = this.entries.slice(0, MAX_LOCAL_MEMORIES);
    }
    return added;
  }

  public markSynced(id: string): void {
    const found = this.entries.find((e) => e.id === id);
    if (found) found.synced = true;
  }

  public saveToBrowser(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(this.entries));
    } catch {
      // Storage quota full; keep in-memory copy
    }
  }

  public static loadFromBrowser(): VectorMemoryStore {
    if (typeof window === 'undefined' || !window.localStorage) {
      return new VectorMemoryStore();
    }
    try {
      const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!raw) return new VectorMemoryStore();
      const parsed = JSON.parse(raw) as VectorMemoryEntry[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return new VectorMemoryStore(parsed);
      }
    } catch {
      // Corrupted cache fallback
    }
    return new VectorMemoryStore();
  }
}
