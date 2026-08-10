// Privacy routes — REQ-010 (Governance and Compliance Agent).
//
// STORY-033: GDPR/CCPA data export and erasure. Administrator-only.

import { Router } from 'express';
import { requireUser } from '../http/currentUser.js';
import { requirePermission } from '../http/rbac.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { exportSubjectData, deleteSubjectData } from '../trust/privacy.js';

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

export default router;
