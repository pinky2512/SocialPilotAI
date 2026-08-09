// Image Generation (extension of the Content Generation Agent).
//
// Generates AI marketing images and HOLDS them for human approval before use —
// same governance as text content. Real generation uses the OpenAI Images API
// (OPENAI_API_KEY); without a key a placeholder SVG is produced so the feature
// stays runnable and testable offline. SWAP-IN POINT: generateBytes().

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { run, get, all } from '../db/index.js';
import { logAction } from '../trust/audit.js';
import { startTask, finishTask } from './taskTracker.js';
import { broker } from '../broker/index.js';
import { holdForApproval } from '../trust/approvals.js';

const AGENT_ID = 'content-generation-agent';
const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGE_DIR = process.env.IMAGE_DIR || join(__dirname, '..', '..', 'data', 'images');
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
const IMAGE_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');

/**
 * generateImage — produce an image from a prompt, persist it as a 'draft', and
 * hold nothing yet (submit for approval is a separate step). Real or placeholder.
 * @returns {object} the content_images row.
 */
export async function generateImage({ userId, prompt, contentId = null, size = '1024x1024' }) {
  if (!prompt || !prompt.trim()) throw new Error('generateImage requires a prompt');
  const taskId = startTask({ agentId: AGENT_ID, taskType: 'generateImage' });
  try {
    const { bytes, mime, ext, source } = await generateBytes({ prompt, size });

    // Insert first to get an id, then write the file named by id.
    const info = run(
      "INSERT INTO content_images (content_id, prompt, status, source, created_by) VALUES (?, ?, 'draft', ?, ?)",
      [contentId, prompt, source, userId]
    );
    const id = info.lastInsertRowid;
    mkdirSync(IMAGE_DIR, { recursive: true });
    const filePath = join(IMAGE_DIR, `${id}.${ext}`);
    writeFileSync(filePath, bytes);
    run('UPDATE content_images SET file_path = ?, mime = ? WHERE id = ?', [filePath, mime, id]);

    logAction({ userId, action: 'image.generated', details: { imageId: id, prompt, source, contentId } });
    finishTask(taskId, 'done');
    broker.publish('imageGenerated', { imageId: id, userId });
    return get('SELECT * FROM content_images WHERE id = ?', [id]);
  } catch (err) {
    finishTask(taskId, 'failed');
    throw err;
  }
}

/**
 * SWAP-IN POINT — return raw image bytes for a prompt.
 * Uses the OpenAI Images API when OPENAI_API_KEY is set; otherwise a placeholder.
 * @returns {Promise<{bytes: Buffer, mime: string, ext: string, source: string}>}
 */
async function generateBytes({ prompt, size }) {
  if (!process.env.OPENAI_API_KEY) {
    return { ...placeholderSvg(prompt), source: 'placeholder' };
  }
  const res = await fetch(`${IMAGE_BASE_URL}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: IMAGE_MODEL, prompt, size, n: 1 }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Image API error ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const item = data?.data?.[0] || {};
  if (item.b64_json) {
    return { bytes: Buffer.from(item.b64_json, 'base64'), mime: 'image/png', ext: 'png', source: `openai:${IMAGE_MODEL}` };
  }
  if (item.url) {
    const img = await fetch(item.url);
    const buf = Buffer.from(await img.arrayBuffer());
    return { bytes: buf, mime: 'image/png', ext: 'png', source: `openai:${IMAGE_MODEL}` };
  }
  throw new Error('Image API returned no image data');
}

// Offline placeholder: a simple branded SVG carrying the prompt text.
function placeholderSvg(prompt) {
  const safe = String(prompt).replace(/[<&>]/g, ' ').slice(0, 80);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <rect width="512" height="512" fill="#171a2b"/>
  <rect x="16" y="16" width="480" height="480" rx="16" fill="#1f2338" stroke="#6c7bff" stroke-width="2"/>
  <text x="256" y="240" fill="#6c7bff" font-family="system-ui" font-size="22" text-anchor="middle">AI image (placeholder)</text>
  <text x="256" y="280" fill="#9aa0be" font-family="system-ui" font-size="14" text-anchor="middle">${safe}</text>
  <text x="256" y="470" fill="#4ad3a8" font-family="system-ui" font-size="12" text-anchor="middle">set OPENAI_API_KEY for real images</text>
</svg>`;
  return { bytes: Buffer.from(svg, 'utf8'), mime: 'image/svg+xml', ext: 'svg' };
}

/** Submit (or re-submit) an image for human approval. */
export function submitImageForApproval({ imageId, requestedBy }) {
  const img = get('SELECT * FROM content_images WHERE id = ?', [imageId]);
  if (!img) throw new Error(`image ${imageId} not found`);
  if (!['draft', 'rejected'].includes(img.status)) {
    throw new Error(`image ${imageId} is '${img.status}', only draft/rejected can be submitted`);
  }
  const approval = holdForApproval({ kind: 'image', targetId: imageId, requestedBy });
  broker.publish('imageApproval', { imageId, approvalId: approval.id, event: 'submitted' });
  return approval;
}

export function listImages({ status } = {}) {
  return status
    ? all('SELECT * FROM content_images WHERE status = ? ORDER BY id DESC', [status])
    : all('SELECT * FROM content_images ORDER BY id DESC');
}

export function getImage(id) {
  return get('SELECT * FROM content_images WHERE id = ?', [id]);
}
