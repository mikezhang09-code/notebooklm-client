/**
 * Server-Sent Events helpers for streaming WorkflowProgress + final results.
 */

import type { Response } from 'express';
import type { WorkflowProgress } from 'notebooklm-client';

export interface SseStream {
  progress: (p: WorkflowProgress) => void;
  /** Emit a custom named event (e.g. streamed `delta` chunks). */
  event: (name: string, data: unknown) => void;
  result: (data: unknown) => void;
  error: (message: string) => void;
  close: () => void;
  readonly closed: boolean;
}

export function openSseStream(res: Response): SseStream {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let closed = false;

  const heartbeat = setInterval(() => {
    if (!closed) {
      try {
        res.write(`: ping\n\n`);
      } catch {
        /* socket broken */
      }
    }
  }, 15_000);

  const send = (event: string, data: unknown): void => {
    if (closed) return;
    try {
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      res.write(`event: ${event}\n`);
      res.write(`data: ${payload}\n\n`);
    } catch {
      /* socket broken */
    }
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    try {
      res.end();
    } catch {
      /* ignore */
    }
  };

  res.on('close', close);

  return {
    progress: (p) => send('progress', p),
    event: (name, data) => send(name, data),
    result: (data) => {
      send('result', data);
      close();
    },
    error: (message) => {
      send('error', { message });
      close();
    },
    close,
    get closed() {
      return closed;
    },
  };
}
