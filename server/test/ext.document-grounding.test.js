// EXTENSION — document-grounded content generation.
//
// Acceptance (text path; PDF path verified manually):
//  - A text/markdown product document is uploaded, its text extracted + stored.
//  - The grounding text is retrievable and drives generation.
//  - Generating with a documentId records it in the audit trail.
//  - Unsupported/invalid inputs are rejected.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let db, doc, agent, seed, get;

before(async () => {
  db = await import('../src/db/index.js');
  doc = await import('../src/agents/documentAgent.js');
  agent = await import('../src/agents/contentGenerationAgent.js');
  ({ seed } = await import('../src/db/seed.js'));
  ({ get } = db);
});

beforeEach(() => {
  db._resetForTests();
  seed();
});

const manager = () => get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;

function textDataUrl(text) {
  return `data:text/plain;base64,${Buffer.from(text, 'utf8').toString('base64')}`;
}

test('uploading a text document extracts and stores the text', async () => {
  const brief = 'NovaGlow serum: vitamin C 15%, fragrance-free, brightening, $29, ships June 1.';
  const meta = await doc.uploadDocument({ userId: manager(), filename: 'brief.txt', dataUrl: textDataUrl(brief) });
  assert.equal(meta.filename, 'brief.txt');
  assert.ok(meta.chars > 0);
  assert.match(doc.getDocumentText(meta.id), /NovaGlow/);
  assert.ok(get("SELECT * FROM audit_log WHERE action = 'document.uploaded'"));
});

test('generating with a document records the grounding in the audit trail', async () => {
  const meta = await doc.uploadDocument({ userId: manager(), filename: 'b.txt', dataUrl: textDataUrl('Product facts here.') });
  const groundingContext = doc.getDocumentText(meta.id);
  await agent.generateContentAI({
    creatorId: manager(), prompt: 'Launch post', useLLM: false, documentId: meta.id, groundingContext,
  });
  const entry = get("SELECT * FROM audit_log WHERE action = 'content.generated' ORDER BY id DESC LIMIT 1");
  assert.equal(JSON.parse(entry.details).documentId, meta.id);
});

test('non-data-URL and unsupported types are rejected', async () => {
  await assert.rejects(() => doc.uploadDocument({ userId: manager(), dataUrl: 'nope' }), /data URL/);
  const bad = `data:application/zip;base64,${Buffer.from('x').toString('base64')}`;
  await assert.rejects(() => doc.uploadDocument({ userId: manager(), dataUrl: bad }), /unsupported/);
});
