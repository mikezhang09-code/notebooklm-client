/**
 * Chat with a notebook. Synchronous — NotebookLM returns the full response
 * in one shot from our transport layer, so we don't need SSE here.
 */

import { Router } from 'express';
import { asyncHandler } from '../lib/handler.js';
import { parseSessionHeader } from '../lib/session-header.js';
import { withClient } from '../lib/client-factory.js';

export const chatRouter = Router();

/**
 * GET /api/chat/history?notebookId=…&limit=50
 * Returns the notebook's persisted conversation turns (chronological).
 */
chatRouter.get(
  '/history',
  asyncHandler(async (req, res) => {
    const session = parseSessionHeader(req);
    const notebookId = typeof req.query['notebookId'] === 'string' ? req.query['notebookId'] : '';
    if (!notebookId) {
      res.status(400).json({ error: 'notebookId is required' });
      return;
    }
    const limit = Number.parseInt(String(req.query['limit'] ?? '50'), 10) || 50;
    const turns = await withClient({ session }, (client) =>
      client.getConversationTurns(notebookId, { limit }),
    );
    res.json({ turns });
  }),
);

interface ChatBody {
  notebookId: string;
  question: string;
  sourceIds?: string[];
  withCitations?: boolean;
}

chatRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const session = parseSessionHeader(req);
    const body = (req.body ?? {}) as Partial<ChatBody>;
    if (!body.notebookId || !body.question) {
      res.status(400).json({ error: 'Missing notebookId or question' });
      return;
    }
    const result = await withClient({ session }, async (client) => {
      const detail = await client.getNotebookDetail(body.notebookId as string);
      const sourceIds = body.sourceIds?.length
        ? body.sourceIds
        : detail.sources.map((s) => s.id);
      if (body.withCitations) {
        return client.sendChatWithCitations(body.notebookId as string, body.question as string, sourceIds);
      }
      return client.sendChat(body.notebookId as string, body.question as string, sourceIds);
    });
    res.json(result);
  }),
);
