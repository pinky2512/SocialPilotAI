// Product document routes (extension of REQ-001, Content Generation Agent).
//
// Upload a product brief / spec sheet (PDF or text) to ground AI generation.

import { Router } from 'express';
import { requireUser } from '../http/currentUser.js';
import { uploadDocument, listDocuments } from '../agents/documentAgent.js';

const router = Router();

// Upload a product document.  POST /api/documents/upload { filename, mime?, dataUrl }
router.post('/upload', requireUser, async (req, res) => {
  const { filename, mime, dataUrl } = req.body || {};
  try {
    const document = await uploadDocument({ userId: req.user.id, filename, mime, dataUrl });
    res.status(201).json({ document });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// List uploaded documents.  GET /api/documents
router.get('/', requireUser, (_req, res) => {
  res.json({ documents: listDocuments() });
});

export default router;
