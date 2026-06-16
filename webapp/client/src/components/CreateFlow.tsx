/**
 * Creation flow modals:
 *  - <TypePicker> — "What do you want to make?" tile grid (excludes Document,
 *    which is upload-only).
 *  - <CreateChooser> — Upload-or-Generate for a known type.
 * Both are presentational; the parent wires the resulting action.
 */
import { Icon } from './Icon';
import { TYPE, TYPES, type TypeKey } from '../lib/registry';

export function TypePicker({
  onPick,
  onClose,
}: {
  onPick: (key: TypeKey) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-root show" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-pad">
          <div className="modal-tt">
            <div>
              <div className="m-type">Create</div>
              <h2>What do you want to make?</h2>
            </div>
            <button className="icon-btn" onClick={onClose}>
              <Icon id="i-close" />
            </button>
          </div>
          <div className="pick-grid">
            {/* Documents aren't "made" here — they're uploaded Word files
                (added via the Upload button / Documents section), so they're
                left out of the "what do you want to make?" grid. */}
            {TYPES.filter((t) => t.key !== 'doc').map((t) => (
              <button
                key={t.key}
                className="pick-tile"
                style={{ '--tc': t.color } as React.CSSProperties}
                onClick={() => onPick(t.key)}
              >
                <span className="g-ic">
                  <Icon id={t.icon} />
                </span>
                <span>{t.label}</span>
                {t.isNew && <span className="n-new">New</span>}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CreateChooser({
  typeKey,
  onUpload,
  onGenerate,
  onWrite,
  onBuild,
  onClose,
}: {
  typeKey: TypeKey;
  onUpload: () => void;
  onGenerate: () => void;
  /** Offered for hand-written types (notes): open the markdown editor. */
  onWrite?: () => void;
  /** Offered for quiz / flashcards / mind maps: open the structured visual editor. */
  onBuild?: () => void;
  onClose: () => void;
}) {
  const t = TYPE[typeKey];
  const multi = t.generate || !!onWrite || !!onBuild;
  return (
    <div
      className="modal-root show"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{ '--tc': t.color } as React.CSSProperties}
    >
      <div className="modal">
        <div className="modal-pad">
          <div className="modal-tt">
            <div>
              <div className="m-type">{t.label}</div>
              <h2>Add {t.label.toLowerCase()}</h2>
              <p className="m-desc">
                {onWrite
                  ? 'Write one in markdown, or upload a finished file.'
                  : onBuild
                    ? `Build one by hand, generate with AI, or upload a finished file.`
                    : t.generate
                      ? 'Upload a finished file, or generate one with AI.'
                      : 'Upload a finished file to store it in your library.'}
              </p>
            </div>
            <button className="icon-btn" onClick={onClose}>
              <Icon id="i-close" />
            </button>
          </div>
          <div className={multi ? 'choose2' : ''}>
            <button className="choose-card" onClick={onUpload}>
              <span className="ch-ic">
                <Icon id="i-upload" />
              </span>
              <b>Upload a file</b>
              <small>Store an existing {t.label.toLowerCase()} in your library.</small>
            </button>
            {onWrite && (
              <button className="choose-card primary" onClick={onWrite}>
                <span className="ch-ic">
                  <Icon id="i-doc" />
                </span>
                <b>Write a {t.label.toLowerCase()}</b>
                <small>Compose a new {t.label.toLowerCase()} in the markdown editor.</small>
              </button>
            )}
            {onBuild && (
              <button className="choose-card primary" onClick={onBuild}>
                <span className="ch-ic">
                  <Icon id={t.icon} />
                </span>
                <b>Build a {t.label.toLowerCase()}</b>
                <small>Compose a new {t.label.toLowerCase()} in the visual editor.</small>
              </button>
            )}
            {t.generate && (
              <button className="choose-card primary" onClick={onGenerate}>
                <span className="ch-ic">
                  <Icon id="i-spark" />
                </span>
                <b>Generate with AI</b>
                <small>Create a new {t.label.toLowerCase()} from a URL, text, file, or research.</small>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
