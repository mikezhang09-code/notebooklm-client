import { Icon } from './Icon';
import { TYPE } from '../lib/registry';
import type { Item } from '../lib/artifacts';

export default function ItemCard({ item, onOpen }: { item: Item; onOpen: (i: Item) => void }) {
  const t = TYPE[item.typeKey] ?? TYPE.report;
  return (
    <div
      className="item"
      style={{ '--tc': t.color } as React.CSSProperties}
      onClick={() => onOpen(item)}
    >
      <div className="item-top">
        <span className="t-ic">
          <Icon id={t.icon} />
        </span>
      </div>
      <h4>{item.title}</h4>
      <div className="i-meta">{item.from ?? 'Free form'}</div>
    </div>
  );
}
