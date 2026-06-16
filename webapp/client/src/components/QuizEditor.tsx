/**
 * Quiz editor — build or edit a quiz with a structured form (no JSON typing).
 * Saves a `quiz` artifact: a new free-form file, into a collection, or
 * overwriting an existing one on edit. Ported from the research-corpus portal's
 * QuizEditorModal, restyled to the app's design system.
 */
import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { getRawText } from '../lib/artifacts';
import { toast } from '../lib/toast';
import {
  OPTION_LETTERS,
  parseQuizQuestions,
  saveStudyArtifact,
  type QuizQuestion,
} from '../lib/study';

const GREEN = '#5f8a5a';

type EditOption = { id: string; text: string; rationale: string; isCorrect: boolean };
type EditQuestion = { id: string; question: string; hint: string; options: EditOption[] };

let qzIdCounter = 0;
const newId = () => `qz${++qzIdCounter}`;

const newOption = (): EditOption => ({ id: newId(), text: '', rationale: '', isCorrect: false });
const newQuestion = (): EditQuestion => ({
  id: newId(),
  question: '',
  hint: '',
  options: [newOption(), newOption(), newOption(), newOption()],
});

function fromParsed(qs: QuizQuestion[]): EditQuestion[] {
  return qs.map((q) => ({
    id: newId(),
    question: q.question,
    hint: q.hint ?? '',
    options: q.answerOptions.map((o) => ({
      id: newId(),
      text: o.text,
      rationale: o.rationale,
      isCorrect: o.isCorrect,
    })),
  }));
}

// Blank option rows are scratch space — dropped on save so the stored file
// always round-trips through parseQuizQuestions.
function serialize(qs: EditQuestion[]): string {
  return JSON.stringify(
    {
      questions: qs.map((q) => ({
        question: q.question.trim(),
        ...(q.hint.trim() ? { hint: q.hint.trim() } : {}),
        answerOptions: q.options
          .filter((o) => o.text.trim())
          .map((o) => ({ text: o.text.trim(), rationale: o.rationale.trim(), isCorrect: o.isCorrect })),
      })),
    },
    null,
    2,
  );
}

function validate(qs: EditQuestion[]): string | null {
  if (qs.length === 0) return 'Add at least one question';
  for (let i = 0; i < qs.length; i++) {
    const n = i + 1;
    if (!qs[i]!.question.trim()) return `Question ${n} needs text`;
    const opts = qs[i]!.options.filter((o) => o.text.trim());
    if (opts.length < 2) return `Question ${n} needs at least two answers`;
    if (!opts.some((o) => o.isCorrect)) return `Question ${n} needs a correct answer marked`;
  }
  return null;
}

export default function QuizEditor({
  editId,
  collectionId,
  initialTitle,
  tc = '#b9892a',
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
  const [questions, setQuestions] = useState<EditQuestion[] | null>(isEdit ? null : [newQuestion()]);
  const [initialJson, setInitialJson] = useState<string | null>(isEdit ? null : serialize([newQuestion()]));
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    getRawText(editId)
      .then(({ content }) => {
        if (cancelled) return;
        const qs = fromParsed(parseQuizQuestions(content));
        setInitialJson(serialize(qs));
        setQuestions(qs);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [editId]);

  const dirty =
    questions !== null &&
    (isEdit
      ? title.trim() !== (initialTitle ?? '') || serialize(questions) !== initialJson
      : title.trim().length > 0 || serialize(questions) !== initialJson);

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

  function patchQuestion(qid: string, patch: Partial<Omit<EditQuestion, 'id' | 'options'>>) {
    setQuestions((qs) => qs && qs.map((q) => (q.id === qid ? { ...q, ...patch } : q)));
  }
  function patchOption(qid: string, oid: string, patch: Partial<Omit<EditOption, 'id'>>) {
    setQuestions((qs) =>
      qs &&
      qs.map((q) =>
        q.id === qid ? { ...q, options: q.options.map((o) => (o.id === oid ? { ...o, ...patch } : o)) } : q,
      ),
    );
  }
  function markCorrect(qid: string, oid: string) {
    setQuestions((qs) =>
      qs &&
      qs.map((q) =>
        q.id === qid ? { ...q, options: q.options.map((o) => ({ ...o, isCorrect: o.id === oid })) } : q,
      ),
    );
  }
  function addOption(qid: string) {
    setQuestions((qs) =>
      qs &&
      qs.map((q) =>
        q.id === qid && q.options.length < OPTION_LETTERS.length ? { ...q, options: [...q.options, newOption()] } : q,
      ),
    );
  }
  function removeOption(qid: string, oid: string) {
    setQuestions((qs) =>
      qs &&
      qs.map((q) =>
        q.id === qid && q.options.length > 2 ? { ...q, options: q.options.filter((o) => o.id !== oid) } : q,
      ),
    );
  }
  function addQuestion() {
    setQuestions((qs) => qs && [...qs, newQuestion()]);
  }
  function removeQuestion(qid: string) {
    const q = questions?.find((x) => x.id === qid);
    const hasContent = !!q && (q.question.trim() || q.options.some((o) => o.text.trim()));
    if (hasContent && !window.confirm('Delete this question?')) return;
    setQuestions((qs) => qs && qs.filter((x) => x.id !== qid));
  }
  function moveQuestion(qid: string, dir: -1 | 1) {
    setQuestions((qs) => {
      if (!qs) return qs;
      const idx = qs.findIndex((q) => q.id === qid);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= qs.length) return qs;
      const next = [...qs];
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
    if (!questions) return;
    const problem = validate(questions);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveStudyArtifact({ editId, collectionId, kind: 'quiz', title: t, json: serialize(questions) });
      toast(isEdit ? 'Quiz saved' : collectionId ? 'Quiz saved to collection' : 'Quiz saved');
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
            <Icon id="i-quiz" />
          </span>
          <b style={{ flex: 1 }}>{isEdit ? 'Edit quiz' : 'New quiz'}</b>
          <button className="btn btn-primary" disabled={saving || loading || !questions || !title.trim() || !dirty} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save quiz'}
          </button>
          <button className="icon-btn" onClick={requestClose} disabled={saving}>
            <Icon id="i-close" />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <input
            className="input"
            placeholder="Quiz title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={saving || loading}
            autoFocus={!isEdit}
            style={{ fontWeight: 600 }}
          />

          {error && !questions ? (
            <div className="empty" style={{ color: 'var(--accent)' }}>
              Failed to load: {error}
            </div>
          ) : loading || !questions ? (
            <div className="empty">Loading…</div>
          ) : (
            <>
              {questions.map((q, qi) => (
                <div key={q.id} style={{ border: '1px solid var(--line)', background: 'var(--card)', borderRadius: 12, padding: 15, display: 'flex', flexDirection: 'column', gap: 11 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>
                      Question {qi + 1}
                    </span>
                    <div style={{ display: 'flex', gap: 2 }}>
                      <button className="icon-btn" title="Move up" onClick={() => moveQuestion(q.id, -1)} disabled={saving || qi === 0} style={{ transform: 'rotate(-90deg)' }}>
                        <Icon id="i-chev" />
                      </button>
                      <button className="icon-btn" title="Move down" onClick={() => moveQuestion(q.id, 1)} disabled={saving || qi === questions.length - 1} style={{ transform: 'rotate(90deg)' }}>
                        <Icon id="i-chev" />
                      </button>
                      <button className="icon-btn" title="Delete question" onClick={() => removeQuestion(q.id)} disabled={saving} style={{ color: 'var(--accent)' }}>
                        <Icon id="i-trash" />
                      </button>
                    </div>
                  </div>

                  <textarea
                    className="input"
                    value={q.question}
                    onChange={(e) => patchQuestion(q.id, { question: e.target.value })}
                    disabled={saving}
                    rows={2}
                    placeholder="Question text"
                    style={{ resize: 'vertical' }}
                  />

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {q.options.map((o, oi) => (
                      <div key={o.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <input
                            type="radio"
                            name={`correct-${q.id}`}
                            checked={o.isCorrect}
                            onChange={() => markCorrect(q.id, o.id)}
                            disabled={saving}
                            title="Mark as the correct answer"
                            aria-label={`Mark answer ${OPTION_LETTERS[oi]} correct`}
                            style={{ accentColor: GREEN, width: 16, height: 16, flexShrink: 0, cursor: 'pointer' }}
                          />
                          <span style={{ color: 'var(--muted)', width: 16, flexShrink: 0 }}>{OPTION_LETTERS[oi]}.</span>
                          <input
                            className="input"
                            value={o.text}
                            onChange={(e) => patchOption(q.id, o.id, { text: e.target.value })}
                            disabled={saving}
                            placeholder={`Answer ${OPTION_LETTERS[oi]}`}
                            style={{ flex: 1 }}
                          />
                          <button className="icon-btn" title="Remove answer" onClick={() => removeOption(q.id, o.id)} disabled={saving || q.options.length <= 2}>
                            <Icon id="i-trash" />
                          </button>
                        </div>
                        <input
                          className="input"
                          value={o.rationale}
                          onChange={(e) => patchOption(q.id, o.id, { rationale: e.target.value })}
                          disabled={saving}
                          placeholder="Why this is right / wrong (optional)"
                          style={{ marginLeft: 42, fontSize: 13, color: 'var(--ink-soft)' }}
                        />
                      </div>
                    ))}
                  </div>

                  <button className="btn btn-soft" style={{ alignSelf: 'flex-start' }} onClick={() => addOption(q.id)} disabled={saving || q.options.length >= OPTION_LETTERS.length}>
                    <Icon id="i-plus" /> Add answer
                  </button>

                  <input
                    className="input"
                    value={q.hint}
                    onChange={(e) => patchQuestion(q.id, { hint: e.target.value })}
                    disabled={saving}
                    placeholder="Hint shown before answering (optional)"
                    style={{ fontSize: 13 }}
                  />
                </div>
              ))}

              <button className="btn btn-soft" style={{ alignSelf: 'flex-start' }} onClick={addQuestion} disabled={saving}>
                <Icon id="i-plus" /> Add question
              </button>
            </>
          )}

          {error && questions && (
            <div className="hint" style={{ color: 'var(--accent)' }}>
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
