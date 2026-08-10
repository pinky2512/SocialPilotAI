// Express application wiring. Kept separate from server.js so tests can import
// the app without binding a port.

import express from 'express';
import { attachCurrentUser } from './http/currentUser.js';
import contentRoutes from './routes/content.js';
import imageRoutes from './routes/images.js';
import documentRoutes from './routes/documents.js';
import approvalRoutes from './routes/approvals.js';
import socialRoutes from './routes/social.js';
import emailRoutes from './routes/email.js';
import analyticsRoutes from './routes/analytics.js';
import recommendationRoutes from './routes/recommendations.js';
import leadRoutes from './routes/leads.js';
import trustRoutes from './routes/trust.js';
import privacyRoutes from './routes/privacy.js';
import notificationRoutes from './routes/notifications.js';
import auditRoutes from './routes/audit.js';
import { requireUser } from './http/currentUser.js';
import { getPermissions } from './agents/securityAgent.js';
import { getLegal } from './trust/legal.js';

export function createApp() {
  const app = express();
  // Larger limit so base64 image uploads fit (STORY-ext image upload).
  app.use(express.json({ limit: '15mb' }));

  // STORY-021 — response-time header for latency observability. Set just before
  // the response is sent (patching res.end) so the header actually lands.
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    const end = res.end;
    res.end = function (...args) {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      if (!res.headersSent) res.set('X-Response-Time', `${ms.toFixed(1)}ms`);
      return end.apply(this, args);
    };
    next();
  });

  app.use(attachCurrentUser);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'social-pilot-ai', time: new Date().toISOString() });
  });

  // Friendly root: this is an API server (the UI is the React client on :5173).
  // Returns a small index of available endpoints so hitting '/' isn't confusing.
  app.get('/', (_req, res) => {
    res.json({
      service: 'Social Pilot AI — API',
      note: 'This is the backend API. The web UI runs separately (React client, default http://localhost:5173).',
      health: '/api/health',
      endpoints: {
        content: '/api/content',
        approvals: '/api/approvals/pending',
        social: '/api/social/accounts',
        audit: '/api/audit',
      },
      docs: 'See README.md and docs/trust-before-intelligence.md',
    });
  });

  // STORY-034 — Privacy Policy & Terms of Service (public).  GET /api/legal
  app.get('/api/legal', (_req, res) => res.json({ legal: getLegal() }));

  // Current user + their permissions (for UI gating).  GET /api/me
  app.get('/api/me', requireUser, (req, res) => {
    res.json({ user: req.user, permissions: getPermissions(req.user.role) });
  });

  app.use('/api/content', contentRoutes);
  app.use('/api/images', imageRoutes);
  app.use('/api/documents', documentRoutes);
  app.use('/api/approvals', approvalRoutes);
  app.use('/api/social', socialRoutes);
  app.use('/api/email', emailRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/recommendations', recommendationRoutes);
  app.use('/api/leads', leadRoutes);
  app.use('/api/trust', trustRoutes);
  app.use('/api/privacy', privacyRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/audit', auditRoutes);

  // JSON 404 for unknown API routes (instead of HTML "Cannot GET").
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

  // Global error handler: log the real cause to the terminal and return a JSON
  // message so failures are diagnosable instead of an opaque 500.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    // eslint-disable-next-line no-console
    console.error('[api error]', err);
    res.status(err.status || 500).json({ error: err.message || 'internal server error' });
  });

  return app;
}
