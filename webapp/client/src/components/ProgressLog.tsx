import { useEffect, useRef } from 'react';

export interface ProgressEntry {
  kind: 'progress' | 'info' | 'error' | 'result';
  text: string;
  ts: number;
}

interface Props {
  entries: ProgressEntry[];
}

const KIND_COLORS: Record<ProgressEntry['kind'], string> = {
  progress: 'text-slate-600',
  info: 'text-brand-600',
  result: 'text-emerald-600',
  error: 'text-rose-600',
};

export default function ProgressLog({ entries }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.scrollTop = ref.current.scrollHeight;
  }, [entries]);

  if (entries.length === 0) return null;

  return (
    <div
      ref={ref}
      className="max-h-60 overflow-y-auto rounded-md border border-slate-200 bg-slate-900/95 p-3 font-mono text-xs text-slate-100"
    >
      {entries.map((e, i) => (
        <div key={i} className={KIND_COLORS[e.kind]}>
          <span className="text-slate-500">
            {new Date(e.ts).toLocaleTimeString()}{' '}
          </span>
          <span className={e.kind === 'error' ? 'text-rose-400' : e.kind === 'result' ? 'text-emerald-400' : 'text-slate-100'}>
            {e.text}
          </span>
        </div>
      ))}
    </div>
  );
}
