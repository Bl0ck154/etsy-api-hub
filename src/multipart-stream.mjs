import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { inputError } from './errors.mjs';

function quoteHeader(value, label) {
  const text = String(value || '');
  if (!text || /[\x00-\x1f\x7f]/.test(text) || text.length > 512) {
    throw inputError('Invalid multipart ' + label, 'INVALID_FILE_DATA');
  }
  return text.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function mimeType(value) {
  const text = String(value || 'application/octet-stream');
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(text)) throw inputError('Invalid multipart MIME type', 'INVALID_FILE_DATA');
  return text;
}

export async function createPathMultipart({ files, form = {}, maxUploadBytes, mimeFor }) {
  if (!Array.isArray(files) || files.length === 0 || !files.every(file => typeof file?.path === 'string')) {
    throw inputError('Streaming multipart requires local file paths', 'INVALID_FILE_DATA');
  }
  const boundary = 'etsy-mcp-' + crypto.randomBytes(18).toString('hex');
  const parts = [];
  let totalFileBytes = 0;
  let formBytes = 0;
  for (const [key, value] of Object.entries(form || {})) {
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      const prefix = Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + quoteHeader(key, 'field') + '"\r\n\r\n');
      const payload = Buffer.from(String(item));
      const suffix = Buffer.from('\r\n');
      formBytes += prefix.length + payload.length + suffix.length;
      if (formBytes > 2 * 1024 * 1024) throw inputError('Multipart form fields exceed 2 MiB', 'UPLOAD_TOO_LARGE');
      parts.push({ type: 'form', prefix, payload, suffix });
    }
  }
  for (const file of files) {
    const info = await fsp.lstat(file.path);
    if (!info.isFile() || info.isSymbolicLink()) throw inputError('Upload source must be a regular file, not a symlink', 'INVALID_FILE_DATA');
    if (info.size <= 0) throw inputError('Multipart files must not be empty', 'INVALID_FILE_DATA');
    if (info.size > maxUploadBytes - totalFileBytes) throw inputError('Multipart upload exceeds configured size limit', 'UPLOAD_TOO_LARGE');
    totalFileBytes += info.size;
    const field = quoteHeader(file.field, 'field');
    const filename = quoteHeader(file.name || path.basename(file.path), 'filename');
    const mime = mimeType(file.mime || file.mime_type || mimeFor(file.path));
    const prefix = Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + field + '"; filename="' + filename + '"\r\nContent-Type: ' + mime + '\r\n\r\n');
    const suffix = Buffer.from('\r\n');
    parts.push({ type: 'file', prefix, path: file.path, size: info.size, suffix });
  }
  const final = Buffer.from('--' + boundary + '--\r\n');
  const contentLength = parts.reduce((sum, p) => sum + p.prefix.length + p.suffix.length + (p.type === 'form' ? p.payload.length : p.size), final.length);
  async function* chunks() {
    for (const part of parts) {
      yield part.prefix;
      if (part.type === 'form') yield part.payload;
      else {
        let total = 0;
        for await (const chunk of fs.createReadStream(part.path, { highWaterMark: 64 * 1024 })) {
          total += chunk.length;
          if (total > part.size) throw inputError('Upload source changed during streaming', 'INVALID_FILE_DATA');
          yield chunk;
        }
        if (total !== part.size) throw inputError('Upload source changed during streaming', 'INVALID_FILE_DATA');
      }
      yield part.suffix;
    }
    yield final;
  }
  // Do not let Node's Readable.toWeb prefetch file chunks before the
  // request starts; create the iterator only when fetch asks for bytes.
  const iterator = chunks();
  const body = new ReadableStream({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    async cancel() {
      if (iterator.return) await iterator.return();
    },
  }, { highWaterMark: 0 });
  return {
    body,
    contentType: 'multipart/form-data; boundary=' + boundary,
    contentLength,
  };
}
