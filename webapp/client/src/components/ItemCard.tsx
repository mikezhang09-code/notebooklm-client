import { Icon } from './Icon';
import { describe } from '../lib/registry';
import type { Item } from '../lib/artifacts';

export default function ItemCard({
  item,
  onOpen,
  onTag,
}: {
  item: Item;
  onOpen: (i: Item) => void;
  /** When set, tag chips become clickable and invoke this with the tag. */
  onTag?: (tag: string) => void;
}) {
  const t = describe(item.kind, item.mimeType, item.title);
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
      {item.tags.length > 0 && (
        <div className="item-tags">
          {item.tags.slice(0, 4).map((tag) => (
            <button
              key={tag}
              className="tag-chip"
              onClick={(e) => {
                e.stopPropagation();
                onTag?.(tag);
              }}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}
      <div className="i-meta">{item.from ?? 'Free form'}</div>
    </div>
  );
}
