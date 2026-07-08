// Server entrypoint. Ensures the schema exists, then listens.

import { getDb } from './db/index.js';
import { createApp } from './app.js';
import { enableRealtimeScoring } from './agents/leadScoringAgent.js';

getDb(); // initialise DB + schema on boot
enableRealtimeScoring(); // STORY-016: reactive lead re-scoring on new engagement

const PORT = process.env.PORT || 4000;
const app = createApp();

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Social Pilot AI server listening on http://localhost:${PORT}`);
});
