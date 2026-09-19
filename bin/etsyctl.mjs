#!/usr/bin/env node
import fs from 'node:fs/promises';
import { loadConfig, publicConfig } from '../src/config.mjs';
import { EtsyHub } from '../src/hub.mjs';
import { EtsyHubError } from '../src/errors.mjs';

function usage() {
  console.log(`etsyctl — shared Etsy API CLI

Usage:
  etsyctl shops
  etsyctl request METHOD /application/... [--shop alias] [--body JSON|@file] [--query key=value ...] [--form key=value ...] [--file field=path ...]
  etsyctl listing get LISTING_ID [--shop alias]
  etsyctl listing list [STATE] [--limit N] [--offset N] [--shop alias]
  etsyctl listing update LISTING_ID JSON|@file [--shop alias] [--no-backup]
  etsyctl listing state LISTING_ID STATE [--shop alias] [--no-backup]
  etsyctl personalization get LISTING_ID [--shop alias]
  etsyctl personalization set LISTING_ID JSON|@file [--shop alias] [--no-backup]
  etsyctl personalization delete LISTING_ID [--shop alias] [--no-backup]
  etsyctl inventory get LISTING_ID [--shop alias]
  etsyctl inventory set LISTING_ID JSON|@file [--shop alias] [--no-backup]
  etsyctl orders list [--limit N] [--offset N] [--paid true|false] [--shipped true|false] [--shop alias]
  etsyctl orders get RECEIPT_ID [--shop alias]
  etsyctl images list LISTING_ID [--shop alias]
  etsyctl images upload LISTING_ID FILE [--rank N] [--alt TEXT] [--shop alias] [--no-backup]
  etsyctl images delete LISTING_ID IMAGE_ID [--shop alias] [--no-backup]
  etsyctl snapshot LISTING_ID [--shop alias]

Notes:
  - Output is JSON, designed for agents and scripts.
  - High-level write commands snapshot the listing first by default.
  - "request" exposes the full Etsy /v3/application/* API surface without draft-only restrictions.
  - Credentials are read from configured credential files and are never printed.
`);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) {
      positional.push(item);
      continue;
    }
    const key = item.slice(2);
    if (key === 'no-backup' || key === 'meta') {
      flags[key] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    i += 1;
    if (['query', 'form', 'file'].includes(key)) {
      flags[key] ||= [];
      flags[key].push(value);
    } else {
      flags[key] = value;
    }
  }
  return { positional, flags };
}

async function jsonInput(value) {
  if (!value) throw new Error('JSON input is required');
  const text = value.startsWith('@') ? await fs.readFile(value.slice(1), 'utf8') : value;
  return JSON.parse(text);
}

function queryObject(items = []) {
  const out = {};
  for (const item of items) {
    const idx = item.indexOf('=');
    if (idx < 1) throw new Error(`Invalid --query value: ${item}; expected key=value`);
    const key = item.slice(0, idx);
    const value = item.slice(idx + 1);
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      out[key] = Array.isArray(out[key]) ? [...out[key], value] : [out[key], value];
    } else out[key] = value;
  }
  return out;
}

function fileObjects(items = []) {
  return items.map(item => {
    const idx = item.indexOf('=');
    if (idx < 1) throw new Error(`Invalid --file value: ${item}; expected field=path`);
    return { field: item.slice(0, idx), path: item.slice(idx + 1) };
  });
}

function bool(value) {
  if (value === undefined) return undefined;
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  throw new Error(`Expected true or false, got: ${value}`);
}

function output(value, includeMeta = false) {
  let shown = value;
  if (!includeMeta && value && typeof value === 'object' && 'data' in value) {
    shown = value.backup ? { data: value.data, backup: value.backup } : value.data;
  }
  console.log(JSON.stringify(shown, null, 2));
}

async function main() {
  const { positional: p, flags: f } = parseArgs(process.argv.slice(2));
  if (!p.length || p[0] === 'help') return usage();
  const config = await loadConfig();
  const hub = new EtsyHub(config);
  const shop = f.shop || null;
  const backup = !f['no-backup'];
  let result;

  if (p[0] === 'shops') return output(publicConfig(config));

  if (p[0] === 'request') {
    if (!p[1] || !p[2]) throw new Error('request requires METHOD and PATH');
    if (f.body && (f.form?.length || f.file?.length)) throw new Error('--body cannot be combined with --form/--file');
    result = await hub.request({
      shop,
      method: p[1],
      apiPath: p[2],
      query: queryObject(f.query),
      body: f.body ? await jsonInput(f.body) : undefined,
      form: f.form?.length ? queryObject(f.form) : null,
      files: f.file?.length ? fileObjects(f.file) : null,
      operation: 'cli.raw',
    });
    return output(result, f.meta);
  }

  if (p[0] === 'snapshot') {
    if (!p[1]) throw new Error('snapshot requires LISTING_ID');
    return output(await hub.snapshotListing(p[1], { shop }), f.meta);
  }

  if (p[0] === 'listing') {
    if (p[1] === 'get') result = await hub.getListing(p[2], { shop });
    else if (p[1] === 'list') result = await hub.listListings({
      shop, state: p[2] || 'active', limit: Number(f.limit || 25), offset: Number(f.offset || 0),
    });
    else if (p[1] === 'update') result = await hub.updateListing(p[2], await jsonInput(p[3]), { shop, backup });
    else if (p[1] === 'state') result = await hub.updateListing(p[2], { state: p[3] }, { shop, backup });
    else throw new Error('Unknown listing command');
    return output(result, f.meta);
  }

  if (p[0] === 'personalization') {
    if (p[1] === 'get') result = await hub.getPersonalization(p[2], { shop });
    else if (p[1] === 'set') {
      const payload = await jsonInput(p[3]);
      const questions = Array.isArray(payload) ? payload : payload.personalization_questions;
      if (!Array.isArray(questions)) throw new Error('Personalization input must be an array or contain personalization_questions');
      result = await hub.setPersonalization(p[2], questions, { shop, backup });
    } else if (p[1] === 'delete') result = await hub.deletePersonalization(p[2], { shop, backup });
    else throw new Error('Unknown personalization command');
    return output(result, f.meta);
  }

  if (p[0] === 'inventory') {
    if (p[1] === 'get') result = await hub.getInventory(p[2], { shop });
    else if (p[1] === 'set') result = await hub.setInventory(p[2], await jsonInput(p[3]), { shop, backup });
    else throw new Error('Unknown inventory command');
    return output(result, f.meta);
  }

  if (p[0] === 'orders') {
    if (p[1] === 'list') result = await hub.listReceipts({
      shop,
      limit: Number(f.limit || 25),
      offset: Number(f.offset || 0),
      wasPaid: bool(f.paid),
      wasShipped: bool(f.shipped),
    });
    else if (p[1] === 'get') result = await hub.getReceipt(p[2], { shop });
    else throw new Error('Unknown orders command');
    return output(result, f.meta);
  }

  if (p[0] === 'images') {
    if (p[1] === 'list') result = await hub.listImages(p[2], { shop });
    else if (p[1] === 'upload') result = await hub.uploadImage(p[2], p[3], {
      shop,
      rank: f.rank === undefined ? undefined : Number(f.rank),
      altText: f.alt,
      backup,
    });
    else if (p[1] === 'delete') result = await hub.deleteImage(p[2], p[3], { shop, backup });
    else throw new Error('Unknown images command');
    return output(result, f.meta);
  }

  throw new Error(`Unknown command: ${p.join(' ')}`);
}

main().catch(error => {
  const payload = {
    ok: false,
    error: error?.code || 'CLI_ERROR',
    message: error?.message || String(error),
    ...(error instanceof EtsyHubError && error.details ? { details: error.details } : {}),
  };
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
});
