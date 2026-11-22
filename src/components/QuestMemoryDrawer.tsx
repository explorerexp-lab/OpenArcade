import React, { useMemo, useState } from 'react';
import { BookOpen, Cpu, Database, Search, Sparkles, X } from 'lucide-react';
import type { DynamicQuest, FactionId, RetrievedMemory, WorldState } from '../game/types';
import type { VectorMemoryStore } from '../game/vectorMemory';

interface QuestMemoryDrawerProps {
  open: boolean;
  quest: DynamicQuest | null;
  world: WorldState;
  memoryStore: VectorMemoryStore;
  memoryVersion: number;
  deepQuestBusy: boolean;
  deepQuestError: string | null;
  onClose: () => void;
  onSelectChoice: (choiceId: string) => void;
  onWeaveLocalQuest: () => void;
  onSynthesizeDeepQuest: () => void;
  onRecordCustomMemory: (text: string, faction: FactionId) => void;
}

const FACTION_STYLES: Record<
  FactionId,
  { border: string; badge: string; label: string }
> = {
  order: {
    border: 'border-[#e5a94c]/55 hover:border-[#f5d18c]',
    badge: 'bg-[#e5a94c]/18 text-[#f5d18c]',
    label: 'Order of the Astrolabe',
  },
  verdant: {
    border: 'border-[#52c78c]/55 hover:border-[#8ef0bc]',
    badge: 'bg-[#52c78c]/18 text-[#8ef0bc]',
    label: 'Verdant Echoes',
  },
  unbound: {
    border: 'border-[#5ec9e8]/55 hover:border-[#9be4fa]',
    badge: 'bg-[#5ec9e8]/18 text-[#9be4fa]',
    label: 'Unbound Seekers',
  },
  neutral: {
    border: 'border-[#f3ece0]/25 hover:border-[#f3ece0]/55',
    badge: 'bg-[#f3ece0]/10 text-[#e8decb]',
    label: 'Neutral Thread',
  },
};

export const QuestMemoryDrawer: React.FC<QuestMemoryDrawerProps> = ({
  open,
  quest,
  world,
  memoryStore,
  memoryVersion,
  deepQuestBusy,
  deepQuestError,
  onClose,
  onSelectChoice,
  onWeaveLocalQuest,
  onSynthesizeDeepQuest,
  onRecordCustomMemory,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [noteFaction, setNoteFaction] = useState<FactionId>('order');

  const memories: RetrievedMemory[] = useMemo(() => {
    void memoryVersion;
    const q = searchQuery.trim();
    if (q.length > 0) {
      return memoryStore.query(q, 6);
    }
    return memoryStore
      .getAll()
      .slice(0, 6)
      .map((entry) => ({ entry, similarity: 1 }));
  }, [memoryStore, memoryVersion, searchQuery]);

  if (!open) return null;

  const handleSaveNote = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = noteInput.trim();
    if (clean.length < 4) return;
    onRecordCustomMemory(clean, noteFaction);
    setNoteInput('');
  };

  return (
    <div
      className="fixed inset-0 z-30 flex justify-end bg-[#0c1018]/72"
      role="dialog"
      aria-modal="true"
      aria-label="Dynamic Quests and Vector Memory Archive"
    >
      <div className="flex h-full w-full max-w-xl flex-col border-l border-[#e5a94c]/35 bg-[#121824] text-[#f3ece0] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#f3ece0]/12 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <BookOpen className="h-5 w-5 text-[#e5a94c]" />
            <div>
              <h2 className="font-display text-lg font-bold tracking-[0.12em] uppercase">
                Living Chronicle & Quests
              </h2>
              <p className="font-mono text-[11px] text-[#a79f90]">
                On-Device 64-Dim Vector DB · {memoryStore.count()} Imprints · Stability{' '}
                {Math.round(world.stability)}%
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close Quest Chronicle"
            onClick={onClose}
            className="flex h-9 w-9 cursor-pointer items-center justify-center border border-[#f3ece0]/20 text-[#d8cfc0] transition hover:border-[#e5a94c] hover:text-[#e5a94c]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* Faction Standing Strip */}
          <div className="grid grid-cols-3 gap-2 border border-[#f3ece0]/12 bg-[#0e131d] p-3 font-mono text-xs tabular-nums">
            <div>
              <div className="text-[10px] tracking-widest text-[#e5a94c] uppercase">Order</div>
              <div className="mt-0.5 text-base font-semibold">{world.orderRep}</div>
            </div>
            <div>
              <div className="text-[10px] tracking-widest text-[#52c78c] uppercase">Verdant</div>
              <div className="mt-0.5 text-base font-semibold">{world.verdantRep}</div>
            </div>
            <div>
              <div className="text-[10px] tracking-widest text-[#5ec9e8] uppercase">Unbound</div>
              <div className="mt-0.5 text-base font-semibold">{world.unboundRep}</div>
            </div>
          </div>

          {/* Active / Resolved Emergent Quest Section */}
          <section className="border border-[#e5a94c]/30 bg-[#171f2e] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] text-[#e5a94c] uppercase">
                <Sparkles className="h-3.5 w-3.5" />
                <span>
                  {quest?.source === 'gemini-carbon'
                    ? 'Gemini 4 Carbon High-Thinking Quest'
                    : 'Local Vector Emergent Quest'}
                </span>
              </div>
              {quest && (
                <span className="font-mono text-[10px] text-[#9eb3c7]">
                  Shrine: {quest.shrineName}
                </span>
              )}
            </div>

            {quest ? (
              <>
                <h3 className="mt-2 font-display text-xl font-bold tracking-wide text-[#f7f1e5]">
                  {quest.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[#dfd7c8]">
                  {quest.premise}
                </p>

                {/* Explicit Vector Memory Anchor Citation */}
                <div className="mt-3 border-l-2 border-[#7cd7f2] bg-[#101622] px-3 py-2 text-xs text-[#b5cde0]">
                  <span className="font-mono text-[10px] tracking-widest text-[#7cd7f2] uppercase">
                    Recalled Vector Anchor:{' '}
                  </span>
                  {quest.memoryAnchor}
                </div>

                {quest.status === 'active' ? (
                  <div className="mt-4 space-y-2.5">
                    {quest.choices.map((choice) => {
                      const style = FACTION_STYLES[choice.stance] ?? FACTION_STYLES.neutral;
                      return (
                        <button
                          key={choice.id}
                          type="button"
                          onClick={() => onSelectChoice(choice.id)}
                          className={`w-full cursor-pointer border bg-[#111724] p-3.5 text-left transition hover:bg-[#192234] ${style.border}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-[#f7f1e5]">
                              {choice.label}
                            </span>
                            <span
                              className={`shrink-0 px-2 py-0.5 font-mono text-[10px] tracking-wider uppercase ${style.badge}`}
                            >
                              {style.label}
                            </span>
                          </div>
                          <div className="mt-1.5 font-mono text-[11px] text-[#c5bcac]">
                            {choice.consequencePreview}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-4 border border-[#52c78c]/45 bg-[#122620] p-3.5 text-sm text-[#d9f5e6]">
                    <div className="font-mono text-[10px] tracking-[0.18em] text-[#52c78c] uppercase">
                      Decree Inscribed into Vector Memory
                    </div>
                    <p className="mt-1.5 leading-relaxed">{quest.outcomeText}</p>
                  </div>
                )}
              </>
            ) : (
              <p className="mt-2 text-sm text-[#b6ad9d]">
                No active shrine decree yet. Weave a new emergent quest from your vector archive.
              </p>
            )}

            {/* Quest Generation Actions */}
            <div className="mt-4 flex flex-wrap gap-2.5 border-t border-[#f3ece0]/12 pt-3.5">
              <button
                type="button"
                onClick={onWeaveLocalQuest}
                className="flex cursor-pointer items-center gap-1.5 border border-[#e5a94c] bg-[#e5a94c] px-3.5 py-2 text-xs font-bold tracking-[0.14em] text-[#101520] uppercase transition hover:bg-[#f2be6a]"
              >
                <Database className="h-3.5 w-3.5" />
                <span>Weave Local Vector Quest</span>
              </button>

              <button
                type="button"
                disabled={deepQuestBusy}
                onClick={onSynthesizeDeepQuest}
                className="flex cursor-pointer items-center gap-1.5 border border-[#7cd7f2]/55 bg-[#11202e] px-3.5 py-2 text-xs font-semibold tracking-[0.12em] text-[#9be4fa] uppercase transition hover:border-[#7cd7f2] disabled:opacity-50"
              >
                <Cpu className="h-3.5 w-3.5" />
                <span>
                  {deepQuestBusy ? 'Synthesizing...' : 'Deep AI Quest (Gemini 4 Carbon)'}
                </span>
              </button>
            </div>

            {deepQuestError && (
              <p className="mt-2.5 border border-[#e05d5d]/45 bg-[#261317] px-3 py-2 text-xs text-[#f5b4b4]">
                {deepQuestError}
              </p>
            )}
          </section>

          {/* On-Device Semantic Vector Memory Explorer */}
          <section className="border border-[#f3ece0]/14 bg-[#0f141f] p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-sm font-bold tracking-[0.14em] text-[#e5a94c] uppercase">
                On-Device Vector Memory DB
              </h3>
              <span className="font-mono text-[10px] text-[#9d9587]">
                Cosine Similarity Retrieval
              </span>
            </div>

            <div className="relative mt-3">
              <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-[#8c8478]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Query vector space (e.g., astrolabe, sentinel, forest, storm)..."
                className="w-full border border-[#f3ece0]/18 bg-[#151c29] py-2 pr-3 pl-9 text-xs text-[#f3ece0] placeholder:text-[#7f796f] focus:border-[#e5a94c] focus:outline-none"
              />
            </div>

            <ul className="mt-3 space-y-2">
              {memories.map(({ entry, similarity }) => (
                <li
                  key={entry.id}
                  className="border border-[#f3ece0]/10 bg-[#151b27] px-3 py-2.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase">
                    <span className="text-[#e5a94c]">
                      {entry.category} · {entry.factionTag}
                    </span>
                    <span className="tabular-nums text-[#7cd7f2]">
                      {searchQuery.trim()
                        ? `sim ${similarity.toFixed(2)}`
                        : `imp ${entry.importance}/10`}
                    </span>
                  </div>
                  <p className="mt-1 leading-relaxed text-[#ddd4c5]">{entry.summary}</p>
                </li>
              ))}
            </ul>

            {/* Record Manual Chronicle Imprint */}
            <form onSubmit={handleSaveNote} className="mt-3.5 flex flex-col gap-2 border-t border-[#f3ece0]/10 pt-3">
              <label className="font-mono text-[10px] tracking-widest text-[#a79f90] uppercase">
                Inscribe Custom Memory Vector
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  maxLength={220}
                  placeholder="Record a vow, omen, or observation..."
                  className="min-w-0 flex-1 border border-[#f3ece0]/18 bg-[#151c29] px-3 py-1.5 text-xs text-[#f3ece0] placeholder:text-[#7f796f] focus:border-[#e5a94c] focus:outline-none"
                />
                <select
                  aria-label="Memory Faction Tag"
                  value={noteFaction}
                  onChange={(e) => setNoteFaction(e.target.value as FactionId)}
                  className="border border-[#f3ece0]/18 bg-[#151c29] px-2 py-1.5 font-mono text-xs text-[#f3ece0] focus:border-[#e5a94c] focus:outline-none"
                >
                  <option value="order">Order</option>
                  <option value="verdant">Verdant</option>
                  <option value="unbound">Unbound</option>
                  <option value="neutral">Neutral</option>
                </select>
                <button
                  type="submit"
                  className="cursor-pointer border border-[#e5a94c]/60 bg-[#1e2636] px-3 py-1.5 font-mono text-xs font-semibold text-[#f5d18c] uppercase transition hover:bg-[#e5a94c] hover:text-[#101520]"
                >
                  Embed
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
};
