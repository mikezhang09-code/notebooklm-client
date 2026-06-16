/**
 * Flashcard deck editor — build or edit a deck with a structured form (front /
 * back per card). Saves a `flashcards` artifact: a new free-form file, into a
 * collection, or overwriting an existing one on edit. Ported from the
 * research-corpus portal's FlashcardEditorModal, restyled.
 */
import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { getRawText } from '../lib/artifacts';
import { toast } from '../lib/toast';
import { parseFlashcards, saveStudyArtifact, type Flashcard } from '../lib/study';

type EditCard = { id: string; front: string; back: string };

let fcIdCounter = 0;
const newId = () => `fc${++fcIdCounter}`;
const newCard = (): EditCard => ({ id: newId(), front: '', back: '' });

function fromParsed(cards: Flashcard[]): EditCard[] {
  return cards.map((c) => ({ id: newId(), front: c.front, back: c.back }));
}
function serialize(cards: EditCard[]): string {
  return JSON.stringify({ cards: cards.map((c) => ({ front: c.front.trim(), back: c.back.trim() })) }, null, 2);
}
function validate(cards: EditCard[]): string | null {
  if (cards.length === 0) return 'Add at least one card';
  for (let i = 0; i < cards.length; i++) {
    const n = i + 1;
    if (!cards[i]!.front.trim()) return `Card ${n} needs front text`;
    if (!cards[i]!.back.trim()) return `Card ${n} needs back text`;
  }
  return null;
}

export default function FlashcardsEditor({
  editId,
  collectionId,
  initialTitle,
  tc = '#5f8a5a',
  onClose,
  onSaved,
}: {
  editId?: string;
  collectionId?: string;
  initialTitle?: string;
  tc?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!editId;
  const [title, setTitle] = useState(initialTitle ?? '');
  const [cards, setCards] = useState<EditCard[] | null>(isEdit ? null : [newCard()]);
  const [initialJson, setInitialJson] = useState<string | null>(isEdit ? null : serialize([newCard()]));
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    getRawText(editId)
      .then(({ content }) => {
        if (cancelled) return;
        const cs = fromParsed(parseFlashcards(content));
        setInitialJson(serialize(cs));
        setCards(cs);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [editId]);

  const dirty =
    cards !== null &&
    (isEdit
      ? title.trim() !== (initialTitle ?? '') || serialize(cards) !== initialJson
      : title.trim().length > 0 || serialize(cards) !== initialJson);

  function requestClose() {
    if (saving) return;
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    onClose();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function patchCard(cid: string, patch: Partial<Omit<EditCard, 'id'>>) {
    setCards((cs) => cs && cs.map((c) => (c.id === cid ? { ...c, ...patch } : c)));
  }
  function addCard() {
    setCards((cs) => cs && [...cs, newCard()]);
  }
  function removeCard(cid: string) {
    const c = cards?.find((x) => x.id === cid);
    const hasContent = !!c && (c.front.trim() || c.back.trim());
    if (hasContent && !window.confirm('Delete this card?')) return;
    setCards((cs) => cs && cs.filter((x) => x.id !== cid));
  }
  function moveCard(cid: string, dir: -1 | 1) {
    setCards((cs) => {
      if (!cs) return cs;
      const idx = cs.findIndex((c) => c.id === cid);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= cs.length) return cs;
      const next = [...cs];
      [next[idx], next[j]] = [next[j]!, next[idx]!];
      return next;
    });
  }

  async function handleSave() {
    const t = title.trim();
    if (!t) {
      setError('Title is required');
      return;
    }
    if (!cards) return;
    const problem = validate(cards);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveStudyArtifact({ editId, collectionId, kind: 'flashcards', title: t, json: serialize(cards) });
      toast(isEdit ? 'Flashcards saved' : collectionId ? 'Flashcards saved to collection' : 'Flashcards saved');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-root show"
      style={{ '--tc': tc, padding: 24 } as React.CSSProperties}
      onClick={(e) => e.target === e.currentTarget && requestClose()}
    >
      <div
        style={{
          width: '92vw',
          maxWidth: 760,
          height: '88vh',
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          borderRadius: 16,
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <span className="t-ic" style={{ width: 34, height: 34 }}>
            <Icon id="i-flash" />
          </span>
          <b style={{ flex: 1 }}>{isEdit ? 'Edit flashcards' : 'New flashcards'}</b>
          <button className="btn btn-primary" disabled={saving || loading || !cards || !title.trim() || !dirty} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save deck'}
          </button>
          <button className="icon-btn" onClick={requestClose} disabled={saving}>
            <Icon id="i-close" />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <input
            className="input"
            placeholder="Deck title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={saving || loading}
            autoFocus={!isEdit}
            style={{ fontWeight: 600 }}
          />

          {error && !cards ? (
            <div className="empty" style={{ color: 'var(--accent)' }}>
              Failed to load: {error}
            </div>
          ) : loading || !cards ? (
            <div className="empty">Loading…</div>
          ) : (
            <>
              {cards.map((c, ci) => (
                <div key={c.id} style={{ border: '1px solid var(--line)', background: 'var(--card)', borderRadius: 12, padding: 15, display: 'flex', flexDirection: 'column', gap: 11 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>
                      Card {ci + 1}
                    </span>
                    <div style={{ display: 'flex', gap: 2 }}>
                      <button className="icon-btn" title="Move up" onClick={() => moveCard(c.id, -1)} disabled={saving || ci === 0} style={{ transform: 'rotate(-90deg)' }}>
                        <Icon id="i-chev" />
                      </button>
                      <button className="icon-btn" title="Move down" onClick={() => moveCard(c.id, 1)} disabled={saving || ci === cards.length - 1} style={{ transform: 'rotate(90deg)' }}>
                        <Icon id="i-chev" />
                      </button>
                      <button className="icon-btn" title="Delete card" onClick={() => removeCard(c.id)} disabled={saving} style={{ color: 'var(--accent)' }}>
                        <Icon id="i-trash" />
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted)' }}>Front</span>
                    <textarea
                      className="input"
                      value={c.front}
                      onChange={(e) => patchCard(c.id, { front: e.target.value })}
                      disabled={saving}
                      rows={2}
                      placeholder="Question or prompt"
                      style={{ resize: 'vertical' }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted)' }}>Back</span>
                    <textarea
                      className="input"
                      value={c.back}
                      onChange={(e) => patchCard(c.id, { back: e.target.value })}
                      disabled={saving}
                      rows={2}
                      placeholder="Answer"
                      style={{ resize: 'vertical' }}
                    />
                  </div>
                </div>
              ))}

              <button className="btn btn-soft" style={{ alignSelf: 'flex-start' }} onClick={addCard} disabled={saving}>
                <Icon id="i-plus" /> Add card
              </button>
            </>
          )}

          {error && cards && (
            <div className="hint" style={{ color: 'var(--accent)' }}>
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
