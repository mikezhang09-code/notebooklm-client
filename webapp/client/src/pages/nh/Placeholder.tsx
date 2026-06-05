/** Lightweight on-brand placeholder used by screens still being built out. */
import { Icon } from '../../components/Icon';

export default function Placeholder({
  eyebrow,
  title,
  sub,
  icon = 'i-layers',
  tc = 'var(--accent)',
  note,
}: {
  eyebrow: string;
  title: string;
  sub?: string;
  icon?: string;
  tc?: string;
  note?: string;
}) {
  return (
    <div className="content">
      <div className="view-head">
        <div className="view-eyebrow">
          <span className="pip" style={{ background: tc }} />
          {eyebrow}
        </div>
        <div className="view-title" style={{ '--tc': tc } as React.CSSProperties}>
          <h1 className="ser">{title}</h1>
        </div>
        {sub && <p className="view-sub">{sub}</p>}
      </div>
      <div className="empty">
        <Icon id={icon} />
        <p>{note ?? 'This screen is being built out next.'}</p>
      </div>
    </div>
  );
}
