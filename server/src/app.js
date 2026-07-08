// Express application wiring. Kept separate from server.js so tests can import
// the app without binding a port.

import express from 'express';
import { attachCurrentUser } from './http/currentUser.js';
import contentRoutes from './routes/content.js';
import approvalRoutes from './routes/approvals.js';
import socialRoutes from './routes/social.js';
import auditRoutes from './routes/audit.js';

export function createApp() {
  const app = express();
  app.use(express.json());
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

  app.use('/api/content', contentRoutes);
  app.use('/api/approvals', approvalRoutes);
  app.use('/api/social', socialRoutes);
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
