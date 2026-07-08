// Server entrypoint. Ensures the schema exists, then listens.

import { getDb } from './db/index.js';
import { createApp } from './app.js';

getDb(); // initialise DB + schema on boot

const PORT = process.env.PORT || 4000;
const app = createApp();

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Social Pilot AI server listening on http://localhost:${PORT}`);
});
