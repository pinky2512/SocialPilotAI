// Content routes — REQ-001 (Content Generation Agent).
//
// STORY-001: generate an AI content draft (held as 'draft', never published).

import { Router } from 'express';
import { requireUser } from '../http/currentUser.js';
import { generateContentAI, editContent, publishContent, recordFeedback, feedbackSummary } from '../agents/contentGenerationAgent.js';
import { getDocumentText } from '../agents/documentAgent.js';
import { all, get } from '../db/index.js';

const router = Router();

// STORY-001 — AI-Driven Content Draft Generation.
// POST /api/content/generate  { prompt, campaignId?, platform?, tone? }
router.post('/generate', requireUser, async (req, res) => {
  const { prompt, campaignId, platform, tone, documentId } = req.body || {};
  if (!prompt || !String(prompt).trim()) {
    return res.status(400).json({ error: 'prompt is required' });
  }
  try {
    const groundingContext = documentId ? (getDocumentText(Number(documentId)) || '') : '';
    const content = await generateContentAI({
      creatorId: req.user.id,
      campaignId: campaignId ?? null,
      prompt,
      platform,
      tone,
      documentId: documentId ? Number(documentId) : null,
      groundingContext,
    });
    res.status(201).json({ content });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// STORY-003 — edit a draft's text (before/after audited).
// PATCH /api/content/:id  { contentText }
router.patch('/:id', requireUser, (req, res) => {
  const { contentText } = req.body || {};
  try {
    const content = editContent({
      contentId: Number(req.params.id),
      editorId: req.user.id,
      contentText,
    });
    res.json({ content });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// STORY-029 — publish approved content (gate-enforced).
// POST /api/content/:id/publish
router.post('/:id/publish', requireUser, (req, res) => {
  try {
    const content = publishContent({ contentId: Number(req.params.id), userId: req.user.id });
    res.json({ content });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// STORY-031 — give feedback on content.  POST /api/content/:id/feedback { rating, comment? }
router.post('/:id/feedback', requireUser, (req, res) => {
  const { rating, comment } = req.body || {};
  try {
    recordFeedback({ contentId: Number(req.params.id), userId: req.user.id, rating, comment });
    res.status(201).json({ ok: true, learning: feedbackSummary() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// STORY-031 — feedback learning summary.  GET /api/content/feedback/summary
router.get('/feedback/summary', requireUser, (_req, res) => {
  res.json({ learning: feedbackSummary() });
});

// List content (optionally filter by status), newest first.
router.get('/', requireUser, (req, res) => {
  const { status } = req.query;
  const rows = status
    ? all('SELECT * FROM content WHERE status = ? ORDER BY id DESC', [status])
    : all('SELECT * FROM content ORDER BY id DESC');
  res.json({ content: rows });
});

router.get('/:id', requireUser, (req, res) => {
  const row = get('SELECT * FROM content WHERE id = ?', [Number(req.params.id)]);
  if (!row) return res.status(404).json({ error: 'content not found' });
  res.json({ content: row });
});

export default router;
