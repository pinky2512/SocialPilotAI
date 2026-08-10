// Product documents (extension of REQ-001, Content Generation Agent).
//
// Upload a product brief / spec sheet (PDF or text) so AI content generation can
// be GROUNDED in real facts about a brand-new product the model has never seen.
// We extract and store the text; generation passes it to the LLM with a
// "use only these facts" instruction. Every upload is audited.

import { PDFParse } from 'pdf-parse';
import { run, get, all } from '../db/index.js';
import { logAction } from '../trust/audit.js';

// Grounding budget — keep well within the model's context window.
const MAX_CHARS = 8000;

/**
 * Upload and extract a product document from a base64 data URL.
 * Supports PDF (application/pdf) and text/* (plain, markdown).
 * @returns {object} document metadata (no raw text).
 */
export async function uploadDocument({ userId, filename = 'document', mime, dataUrl }) {
  const m = typeof dataUrl === 'string' && dataUrl.match(/^data:(.+?);base64,(.*)$/s);
  if (!m) throw new Error('uploadDocument requires a base64 data URL');
  const detected = mime || m[1];
  const bytes = Buffer.from(m[2], 'base64');

  let text = '';
  if (detected === 'application/pdf') {
    const parser = new PDFParse({ data: bytes });
    const res = await parser.getText();
    text = res?.text || '';
  } else if (detected.startsWith('text/')) {
    text = bytes.toString('utf8');
  } else {
    throw new Error(`unsupported document type '${detected}' — use a PDF or text file`);
  }

  text = text
    .replace(/--\s*\d+\s*of\s*\d+\s*--/g, ' ') // pdf-parse page markers
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CHARS);
  if (!text) throw new Error('no extractable text found in the document');

  const info = run(
    'INSERT INTO product_documents (filename, mime, extracted_text, chars, uploaded_by) VALUES (?, ?, ?, ?, ?)',
    [filename, detected, text, text.length, userId]
  );
  logAction({ userId, action: 'document.uploaded', details: { documentId: info.lastInsertRowid, filename, mime: detected, chars: text.length } });
  return getDocumentMeta(info.lastInsertRowid);
}

export function listDocuments() {
  return all('SELECT id, filename, mime, chars, created_at FROM product_documents ORDER BY id DESC');
}

export function getDocumentMeta(id) {
  return get('SELECT id, filename, mime, chars, created_at FROM product_documents WHERE id = ?', [id]);
}

/** The extracted text used to ground generation. */
export function getDocumentText(id) {
  const d = get('SELECT extracted_text FROM product_documents WHERE id = ?', [id]);
  return d ? d.extracted_text : null;
}
