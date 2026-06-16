/**
 * Interactive quiz viewer — plays a quiz artifact (kind `quiz`) one question at
 * a time: pick an answer, see which option was right (with rationales), reveal
 * an optional hint, then a final score with a restart. Reads the artifact's raw
 * JSON via GET …/raw and parses it tolerantly. Styled to the app's design
 * system; ported in spirit from the research-corpus portal's QuizModal.
 */
import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { getRawText, type Item } from '../lib/artifacts';
import { OPTION_LETTERS, parseQuizQuestions, type QuizQuestion } from '../lib/study';

const GREEN = '#5f8a5a';

export default function QuizView({
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
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  // selected[i] = the option index the user picked for question i (absent = unanswered).
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [showHint, setShowHint] = useState(false);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getRawText(item.id)
      .then(({ content }) => {
        if (cancelled) return;
        try {
          setQuestions(parseQuizQuestions(content));
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Invalid quiz JSON');
        }
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [item.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const total = questions?.length ?? 0;
  const current = questions?.[index];
  const picked = selected[index];
  const answered = picked !== undefined;

  const correctCount = useMemo(
    () =>
      questions
        ? Object.entries(selected).reduce(
            (n, [qi, oi]) => n + (questions[Number(qi)]?.answerOptions[oi]?.isCorrect ? 1 : 0),
            0,
          )
        : 0,
    [questions, selected],
  );

  function pick(optionIndex: number) {
    if (answered) return;
    setSelected((prev) => ({ ...prev, [index]: optionIndex }));
  }
  function goNext() {
    setShowHint(false);
    if (index < total - 1) setIndex(index + 1);
    else setFinished(true);
  }
  function goPrev() {
    setShowHint(false);
    if (index > 0) setIndex(index - 1);
  }
  function restart() {
    setSelected({});
    setIndex(0);
    setShowHint(false);
    setFinished(false);
  }

  return (
    <div
      className="modal-root show"
      style={{ '--tc': tc, padding: 24 } as React.CSSProperties}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          width: '92vw',
          maxWidth: 680,
          maxHeight: '88vh',
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
            <Icon id="i-quiz" />
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
            {questions && (
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                {finished
                  ? `${total} question${total !== 1 ? 's' : ''}`
                  : `Question ${index + 1} of ${total}`}
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

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '22px 24px' }}>
          {error ? (
            <div className="empty" style={{ color: 'var(--accent)' }}>
              Failed to load: {error}
            </div>
          ) : !questions || !current ? (
            <div className="empty">Loading…</div>
          ) : finished ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                gap: 14,
                padding: '32px 0',
              }}
            >
              <span style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>
                Your score
              </span>
              <span style={{ fontSize: 56, fontWeight: 700, lineHeight: 1, color: 'var(--ink)' }}>
                {correctCount}
                <span style={{ color: 'var(--muted)' }}>/{total}</span>
              </span>
              <span style={{ color: 'var(--ink-soft)' }}>
                {correctCount === total
                  ? 'Perfect — every question correct.'
                  : `${Math.round((correctCount / total) * 100)}% correct`}
              </span>
              <button className="btn btn-soft" style={{ marginTop: 6 }} onClick={restart}>
                <Icon id="i-refresh" /> Restart quiz
              </button>
            </div>
          ) : (
            <>
              <p style={{ fontSize: 18, lineHeight: 1.45, color: 'var(--ink)', margin: '0 0 18px' }}>
                {current.question}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {current.answerOptions.map((o, oi) => {
                  const isPicked = picked === oi;
                  const reveal = answered;
                  const border = !reveal
                    ? 'var(--line)'
                    : o.isCorrect
                      ? GREEN
                      : isPicked
                        ? 'var(--accent)'
                        : 'var(--line)';
                  const bg = !reveal
                    ? 'var(--card)'
                    : o.isCorrect
                      ? 'color-mix(in srgb, ' + GREEN + ' 12%, var(--card))'
                      : isPicked
                        ? 'var(--accent-soft)'
                        : 'var(--card)';
                  return (
                    <button
                      key={oi}
                      type="button"
                      disabled={reveal}
                      onClick={() => pick(oi)}
                      style={{
                        textAlign: 'left',
                        border: `1px solid ${border}`,
                        background: bg,
                        borderRadius: 10,
                        padding: '13px 15px',
                        cursor: reveal ? 'default' : 'pointer',
                        opacity: reveal && !o.isCorrect && !isPicked ? 0.7 : 1,
                        transition: 'background .12s, border-color .12s',
                      }}
                    >
                      <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
                        <span style={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums', width: 16, flexShrink: 0 }}>
                          {OPTION_LETTERS[oi]}.
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ color: 'var(--ink)' }}>{o.text}</span>
                          {reveal && o.isCorrect && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, color: GREEN, fontSize: 12.5 }}>
                              <Icon id="i-check" /> <strong>Right answer</strong>
                            </span>
                          )}
                          {reveal && !o.isCorrect && isPicked && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, color: 'var(--accent)', fontSize: 12.5 }}>
                              <Icon id="i-close" /> Your answer
                            </span>
                          )}
                          {reveal && o.rationale && (
                            <p style={{ margin: '6px 0 0', fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-soft)' }}>
                              {o.rationale}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {!answered && current.hint && (
                <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                  <button
                    type="button"
                    className="btn btn-soft"
                    onClick={() => setShowHint((h) => !h)}
                  >
                    Hint <Icon id="i-down" />
                  </button>
                  {showHint && (
                    <div
                      style={{
                        width: '100%',
                        border: '1px solid var(--line)',
                        background: 'var(--card-2)',
                        borderRadius: 10,
                        padding: '12px 15px',
                        color: 'var(--ink-soft)',
                        fontSize: 14,
                        lineHeight: 1.5,
                      }}
                    >
                      {current.hint}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {questions && current && !finished && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '14px 18px',
              borderTop: '1px solid var(--line)',
            }}
          >
            <button className="btn btn-soft" onClick={goPrev} disabled={index === 0}>
              <Icon id="i-back" /> Back
            </button>
            <button className="btn btn-primary" onClick={goNext}>
              {index < total - 1 ? (
                <>
                  Next <Icon id="i-chev" />
                </>
              ) : (
                'See results'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
