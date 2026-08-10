// EXTENSION — AI image generation, held for approval.
//
// Uses the placeholder path (no OPENAI_API_KEY) so the test never hits the
// network. Acceptance:
//  - generateImage persists an image 'draft', writes a file, and audits it.
//  - Submitting holds it at the approval gate (kind=image).
//  - Approve advances the image to 'approved'; nothing bypasses the gate.

import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

process.env.DB_FILE = ':memory:';
process.env.IMAGE_DIR = join(process.cwd(), 'test', '_img_tmp');
delete process.env.OPENAI_API_KEY; // force placeholder path

let db, img, gov, seed, get;

before(async () => {
  db = await import('../src/db/index.js');
  img = await import('../src/agents/imageAgent.js');
  gov = await import('../src/agents/governanceAgent.js');
  ({ seed } = await import('../src/db/seed.js'));
  ({ get } = db);
});

beforeEach(() => {
  db._resetForTests();
  seed();
});

afterEach(() => {
  try { rmSync(process.env.IMAGE_DIR, { recursive: true, force: true }); } catch {}
});

const manager = () => get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
const admin = () => get('SELECT id FROM users WHERE role = ?', ['administrator']).id;

test('generateImage creates a draft image, writes a file, audits it', async () => {
  const image = await img.generateImage({ userId: manager(), prompt: 'CeraVe cleanser hero shot' });
  assert.equal(image.status, 'draft');
  assert.equal(image.source, 'placeholder');
  assert.ok(image.file_path && existsSync(image.file_path));
  assert.ok(get("SELECT * FROM audit_log WHERE action = 'image.generated'"));
});

test('an image only goes live via the approval gate', async () => {
  const image = await img.generateImage({ userId: manager(), prompt: 'summer promo' });
  const approval = img.submitImageForApproval({ imageId: image.id, requestedBy: manager() });
  assert.equal(get('SELECT status FROM content_images WHERE id = ?', [image.id]).status, 'pending_approval');

  const pending = gov.listPending();
  assert.ok(pending.some((p) => p.kind === 'image'));

  gov.decide({ approvalId: approval.id, approverId: admin(), decision: 'approved' });
  assert.equal(get('SELECT status FROM content_images WHERE id = ?', [image.id]).status, 'approved');
});

test('generateImage rejects an empty prompt', async () => {
  await assert.rejects(() => img.generateImage({ userId: manager(), prompt: '  ' }));
});

test('uploadImage stores a user-provided image (data URL)', () => {
  // 1x1 transparent PNG
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
  const image = img.uploadImage({ userId: manager(), dataUrl, label: 'New product photo' });
  assert.equal(image.source, 'upload');
  assert.equal(image.status, 'draft');
  assert.ok(existsSync(image.file_path));
  assert.ok(get("SELECT * FROM audit_log WHERE action = 'image.uploaded'"));
});

test('uploadImage rejects a non-data-URL', () => {
  assert.throws(() => img.uploadImage({ userId: manager(), dataUrl: 'not-a-data-url' }), /data URL/);
});

test('a post can carry an attached image (text + image scheduled together)', async () => {
  const { generateContent } = await import('../src/agents/contentGenerationAgent.js');
  const social = await import('../src/agents/socialMediaAgent.js');
  const image = await img.generateImage({ userId: manager(), prompt: 'hero' });
  const c = generateContent({ creatorId: manager(), prompt: 'Launch' });
  const acct = social.connectAccount({ userId: manager(), platform: 'twitter', handle: '@b' });
  const [post] = social.schedulePost({ userId: manager(), contentId: c.id, accountIds: [acct.id], imageId: image.id });
  assert.equal(post.image_id, image.id);
});
