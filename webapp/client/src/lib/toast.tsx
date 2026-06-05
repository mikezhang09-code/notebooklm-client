/**
 * Minimal bottom-center toast — imperative `toast(msg)` from anywhere, rendered
 * by a single <ToastHost/> mounted at the app root.
 */
import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';

type Listener = (msg: string) => void;
const listeners = new Set<Listener>();

export function toast(msg: string): void {
  for (const l of listeners) l(msg);
}

export function ToastHost() {
  const [msg, setMsg] = useState('');
  const [show, setShow] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const listener: Listener = (m) => {
      setMsg(m);
      setShow(true);
      clearTimeout(timer);
      timer = setTimeout(() => setShow(false), 2200);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className={`toast${show ? ' show' : ''}`}>
      <Icon id="i-check" />
      {msg}
    </div>
  );
}
