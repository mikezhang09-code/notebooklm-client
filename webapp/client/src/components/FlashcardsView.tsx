/**
 * Flashcard viewer — flip through a deck artifact (kind `flashcards`): click or
 * Space/Enter to flip a card, ←/→ to navigate, and self-grade right/wrong as a
 * running tally. Reads the artifact's raw JSON via GET …/raw and parses it
 * tolerantly. Ported in spirit from the research-corpus portal's FlashcardsModal.
 */
import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { getRawText, type Item } from '../lib/artifacts';
import { parseFlashcards, type Flashcard } from '../lib/study';

const GREEN = '#5f8a5a';

export default function FlashcardsView({
  item,
  tc = 'var(--accent)',
  onClose,
  onEdit,
}: {
  item: Item;
  tc?: string;
  onClose: () => void;
  onEdit?: () => void;
}) {
  const [cards, setCards] = useState<Flashcard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [correct, setCorrect] = useState(0);
  const [incorrect, setIncorrect] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getRawText(item.id)
      .then(({ content }) => {
        if (cancelled) return;
        try {
          setCards(parseFlashcards(content));
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Invalid flashcard JSON');
        }
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [item.id]);

  function go(delta: number) {
    if (!cards) return;
    setIndex((i) => (i + delta + cards.length) % cards.length);
    setFlipped(false);
  }

  function score(kind: 'correct' | 'incorrect') {
    if (kind === 'correct') setCorrect((n) => n + 1);
    else setIncorrect((n) => n + 1);
    if (cards && index < cards.length - 1) go(1);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (!cards) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        go(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        go(1);
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        setFlipped((f) => !f);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, index, onClose]);

  const current = cards?.[index];

  return (
    <div
      className="modal-root show"
      style={{ '--tc': tc, padding: 24 } as React.CSSProperties}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          width: '92vw',
          maxWidth: 640,
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          borderRadius: 16,
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 18px',
            borderBottom: '1px solid var(--line)',
          }}
        >
          <span className="t-ic" style={{ width: 34, height: 34 }}>
            <Icon id="i-flash" />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b
              style={{
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {item.title}
            </b>
            {cards && (
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                {cards.length} card{cards.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {onEdit && (
            <button className="btn btn-soft" onClick={onEdit}>
              <Icon id="i-doc" /> Edit
            </button>
          )}
          <button className="icon-btn" onClick={onClose}>
            <Icon id="i-close" />
          </button>
        </div>

        <div style={{ padding: 22 }}>
          {error ? (
            <div className="empty" style={{ color: 'var(--accent)' }}>
              Failed to load: {error}
            </div>
          ) : !cards || !current ? (
            <div className="empty">Loading…</div>
          ) : (
            <>
              <div
                role="button"
                tabIndex={0}
                onClick={() => setFlipped((f) => !f)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setFlipped((f) => !f);
                  }
                }}
                style={{
                  position: 'relative',
                  cursor: 'pointer',
                  background: flipped ? 'var(--card-2)' : 'var(--rail)',
                  color: flipped ? 'var(--ink)' : 'var(--rail-ink)',
                  border: '1px solid var(--line)',
                  borderRadius: 14,
                  minHeight: 270,
                  display: 'flex',
                  flexDirection: 'column',
                  padding: 22,
                  boxShadow: 'var(--shadow)',
                }}
              >
                <span style={{ position: 'absolute', top: 12, left: 16, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.6 }}>
                  {index + 1} / {cards.length}
                </span>
                <span style={{ position: 'absolute', top: 12, right: 16, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.6 }}>
                  {flipped ? 'Answer' : 'Question'}
                </span>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 22 }}>
                  <p style={{ fontSize: 20, lineHeight: 1.4, textAlign: 'center', maxWidth: '90%', whiteSpace: 'pre-wrap', margin: 0 }}>
                    {flipped ? current.back : current.front}
                  </p>
                </div>
                <div style={{ textAlign: 'center', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.5, marginTop: 8 }}>
                  {flipped ? 'Tap to flip back' : 'Tap to see answer'}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 18 }}>
                <button className="icon-btn" aria-label="Previous card" onClick={() => go(-1)}>
                  <Icon id="i-back" />
                </button>
                <div style={{ display: 'flex', gap: 12 }}>
                  <button
                    type="button"
                    className="btn btn-soft"
                    style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
                    onClick={() => score('incorrect')}
                  >
                    <Icon id="i-close" /> {incorrect}
                  </button>
                  <button
                    type="button"
                    className="btn btn-soft"
                    style={{ color: GREEN, borderColor: GREEN }}
                    onClick={() => score('correct')}
                  >
                    <Icon id="i-check" /> {correct}
                  </button>
                </div>
                <button className="icon-btn" aria-label="Next card" onClick={() => go(1)} style={{ transform: 'scaleX(-1)' }}>
                  <Icon id="i-back" />
                </button>
              </div>

              <p style={{ textAlign: 'center', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', marginTop: 16 }}>
                Space / Enter to flip · ← → to navigate · Esc to close
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
