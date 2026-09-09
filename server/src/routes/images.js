// Image routes (extension of REQ-001, Content Generation Agent).
//
// Generate AI marketing images, serve them, and submit them for approval.
// Approve/reject is done via the shared /api/approvals/:id endpoints.

import { readFileSync } from 'node:fs';
import { Router } from 'express';
import { requireUser } from '../http/currentUser.js';
import { generateImage, uploadImage, restyleImage, submitImageForApproval, listImages, getImage } from '../agents/imageAgent.js';

const router = Router();

// Generate an image.  POST /api/images/generate { prompt, contentId?, size? }
router.post('/generate', requireUser, async (req, res) => {
  const { prompt, contentId, size } = req.body || {};
  try {
    const image = await generateImage({ userId: req.user.id, prompt, contentId: contentId ?? null, size });
    res.status(201).json({ image });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Upload an image (optional, for new products).  POST /api/images/upload { dataUrl, label?, contentId? }
router.post('/upload', requireUser, (req, res) => {
  const { dataUrl, label, contentId } = req.body || {};
  try {
    const image = uploadImage({ userId: req.user.id, dataUrl, label, contentId: contentId ?? null });
    res.status(201).json({ image });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Restyle a product photo into a described scene/color grade.
// POST /api/images/restyle { dataUrl, prompt, contentId?, size? }
router.post('/restyle', requireUser, async (req, res) => {
  const { dataUrl, prompt, contentId, size } = req.body || {};
  try {
    const image = await restyleImage({ userId: req.user.id, dataUrl, prompt, contentId: contentId ?? null, size });
    res.status(201).json({ image });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// List images.  GET /api/images?status=approved
router.get('/', requireUser, (req, res) => {
  res.json({ images: listImages({ status: req.query.status }) });
});

// Submit for approval.  POST /api/images/:id/submit
router.post('/:id/submit', requireUser, (req, res) => {
  try {
    const approval = submitImageForApproval({ imageId: Number(req.params.id), requestedBy: req.user.id });
    res.status(201).json({ approval });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Serve the image bytes.  GET /api/images/:id/file
// Public (no x-user-id) so <img src> can load it — the bytes are the deliverable,
// not a secret; approval still gates whether the image may be *used*.
router.get('/:id/file', (req, res) => {
  const img = getImage(Number(req.params.id));
  if (!img || !img.file_path) return res.status(404).json({ error: 'image not found' });
  try {
    res.type(img.mime || 'application/octet-stream').send(readFileSync(img.file_path));
  } catch {
    res.status(404).json({ error: 'image file missing' });
  }
});

export default router;
