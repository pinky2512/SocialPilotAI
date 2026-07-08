// Content routes — REQ-001 (Content Generation Agent).
//
// STORY-001: generate an AI content draft (held as 'draft', never published).

import { Router } from 'express';
import { requireUser } from '../http/currentUser.js';
import { generateContent } from '../agents/contentGenerationAgent.js';
import { all, get } from '../db/index.js';

const router = Router();

// STORY-001 — AI-Driven Content Draft Generation.
// POST /api/content/generate  { prompt, campaignId?, platform?, tone? }
router.post('/generate', requireUser, (req, res) => {
  const { prompt, campaignId, platform, tone } = req.body || {};
  if (!prompt || !String(prompt).trim()) {
    return res.status(400).json({ error: 'prompt is required' });
  }
  try {
    const content = generateContent({
      creatorId: req.user.id,
      campaignId: campaignId ?? null,
      prompt,
      platform,
      tone,
    });
    res.status(201).json({ content });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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
