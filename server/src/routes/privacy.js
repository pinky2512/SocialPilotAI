// Privacy routes — REQ-010 (Governance and Compliance Agent).
//
// STORY-033: GDPR/CCPA data export and erasure. Administrator-only.

import { Router } from 'express';
import { requireUser } from '../http/currentUser.js';
import { requirePermission } from '../http/rbac.js';
import { PERMISSIONS } from '../auth/permissions.js';
import {
  exportSubjectData,
  deleteSubjectData,
  createExportRequest,
  listExportRequests,
  getExportRequest,
  processPendingExports,
} from '../trust/privacy.js';

const router = Router();

router.use(requireUser, requirePermission(PERMISSIONS.PRIVACY_MANAGE));

// Export a data subject's data.  POST /api/privacy/export { subject }
router.post('/export', (req, res) => {
  try {
    const data = exportSubjectData({ email: (req.body || {}).subject, requestedBy: req.user.id });
    res.json({ export: data });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Erase a data subject's PII.  POST /api/privacy/delete { subject }
router.post('/delete', (req, res) => {
  try {
    const result = deleteSubjectData({ email: (req.body || {}).subject, requestedBy: req.user.id });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// STORY-035 — queued export requests.
// POST /api/privacy/requests { subject }
router.post('/requests', (req, res) => {
  try {
    res.status(201).json({ request: createExportRequest({ subject: (req.body || {}).subject, requestedBy: req.user.id }) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/privacy/requests
router.get('/requests', (_req, res) => {
  res.json({ requests: listExportRequests() });
});

// POST /api/privacy/requests/process  — process all pending in one batch
router.post('/requests/process', (req, res) => {
  res.json(processPendingExports({ processedBy: req.user.id }));
});

// GET /api/privacy/requests/:id  — one request with its stored result
router.get('/requests/:id', (req, res) => {
  const request = getExportRequest(Number(req.params.id));
  if (!request) return res.status(404).json({ error: 'request not found' });
  res.json({ request });
});

export default router;
