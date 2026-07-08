// Express application wiring. Kept separate from server.js so tests can import
// the app without binding a port.

import express from 'express';
import { attachCurrentUser } from './http/currentUser.js';
import contentRoutes from './routes/content.js';
import approvalRoutes from './routes/approvals.js';

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(attachCurrentUser);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'social-pilot-ai', time: new Date().toISOString() });
  });

  app.use('/api/content', contentRoutes);
  app.use('/api/approvals', approvalRoutes);

  return app;
}
