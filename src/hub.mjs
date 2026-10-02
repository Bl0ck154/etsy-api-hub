import fs from 'node:fs/promises';
import path from 'node:path';
import { TokenFileStore } from './token-store.mjs';
import { EtsyClient } from './client.mjs';
import { inputError } from './errors.mjs';
import {
  normalizeListingChanges,
  normalizeListingCollection,
  normalizeListingData,
  preserveExistingAddOnPrices,
  validatePersonalizationQuestions,
} from './etsy-schema.mjs';

function id(value, name) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text) || Number(text) < 1) throw inputError(`${name} must be a positive numeric id`);
  return text;
}

function isoFileStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export class EtsyHub {
  constructor(config, { fetchImpl = fetch, tokenStoreFactory = null } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.tokenStoreFactory = tokenStoreFactory;
    this.clients = new Map();
  }

  shop(alias = null) {
    const name = alias || this.config.default_shop;
    const cfg = this.config.shops[name];
    if (!cfg) throw inputError(`Unknown shop alias: ${name}`, 'UNKNOWN_SHOP');
    return { alias: name, ...cfg, shop_id: String(cfg.shop_id) };
  }

  client(alias = null) {
    const shop = this.shop(alias);
    if (!this.clients.has(shop.alias)) {
      const provided = this.tokenStoreFactory
        ? this.tokenStoreFactory({ shop, config: this.config, fetchImpl: this.fetchImpl })
        : null;
      const tokenStore = provided || new TokenFileStore(shop.credential_file, { fetchImpl: this.fetchImpl });
      this.clients.set(shop.alias, new EtsyClient({ tokenStore, fetchImpl: this.fetchImpl }));
    }
    return this.clients.get(shop.alias);
  }

  async audit({ shop, method, apiPath, status = null, operation = null, ok = true }) {
    const file = this.config.audit_file;
    if (!file) return;
    const entry = {
      ts: new Date().toISOString(),
      shop: shop.alias,
      shop_id: shop.shop_id,
      method,
      path: apiPath,
      ...(operation ? { operation } : {}),
      ...(status != null ? { status } : {}),
      ok,
    };
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.appendFile(file, JSON.stringify(entry) + '\n', { mode: 0o600 });
    } catch {
      // Audit logging must never leak credentials or turn a successful Etsy
      // operation into an application-level failure.
    }
  }

  async request({ shop: alias = null, method = 'GET', apiPath, query, body, form, files, multipart = false, operation = 'raw' } = {}) {
    const shop = this.shop(alias);
    try {
      const result = await this.client(shop.alias).request({ method, apiPath, query, body, form, files, multipart });
      await this.audit({ shop, method: String(method).toUpperCase(), apiPath, status: result.meta.status, operation, ok: true });
      return result;
    } catch (error) {
      await this.audit({ shop, method: String(method).toUpperCase(), apiPath, status: error?.status, operation, ok: false });
      throw error;
    }
  }

  async getListing(listingId, { shop = null, includes = ['Images', 'Videos', 'Personalization'] } = {}) {
    const result = await this.request({
      shop, apiPath: `/application/listings/${id(listingId, 'listing_id')}`,
      query: includes?.length ? { includes: includes.join(',') } : null,
      operation: 'listing.get',
    });
    return { ...result, data: normalizeListingData(result.data) };
  }

  async listListings({ shop = null, state = 'active', limit = 25, offset = 0, sortOn = undefined, sortOrder = undefined, includes = undefined } = {}) {
    const cfg = this.shop(shop);
    const safeState = String(state || 'active');
    const associations = Array.isArray(includes) ? includes.join(',') : includes;
    const result = await this.request({
      shop: cfg.alias,
      apiPath: `/application/shops/${cfg.shop_id}/listings`,
      query: { state: safeState, limit, offset, sort_on: sortOn, sort_order: sortOrder, includes: associations },
      operation: 'listing.list',
    });
    return { ...result, data: normalizeListingCollection(result.data) };
  }

  async snapshotListing(listingId, { shop = null } = {}) {
    const cfg = this.shop(shop);
    const lid = id(listingId, 'listing_id');
    const [listing, inventory, personalization] = await Promise.all([
      this.getListing(lid, { shop: cfg.alias }),
      this.request({ shop: cfg.alias, apiPath: `/application/listings/${lid}/inventory`, operation: 'snapshot.inventory' }),
      this.request({ shop: cfg.alias, apiPath: `/application/listings/${lid}/personalization`, operation: 'snapshot.personalization' }),
    ]);
    const snapshot = {
      captured_at: new Date().toISOString(),
      shop: cfg.alias,
      shop_id: cfg.shop_id,
      listing_id: lid,
      listing: listing.data,
      inventory: inventory.data,
      personalization: personalization.data,
    };
    const dir = path.join(this.config.backup_dir, cfg.alias, lid);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${isoFileStamp()}.json`);
    await fs.writeFile(file, JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600 });
    return { data: { file, snapshot }, meta: { status: 200, operation: 'snapshot' } };
  }

  async updateListing(listingId, changes, { shop = null, backup = true } = {}) {
    const cfg = this.shop(shop);
    const lid = id(listingId, 'listing_id');
    let snapshot = null;
    if (backup) snapshot = (await this.snapshotListing(lid, { shop: cfg.alias })).data.file;
    const result = await this.request({
      shop: cfg.alias,
      method: 'PATCH',
      apiPath: `/application/shops/${cfg.shop_id}/listings/${lid}`,
      body: normalizeListingChanges(changes),
      operation: 'listing.update',
    });
    return { ...result, backup: snapshot };
  }

  async deleteListing(listingId, { shop = null, backup = true } = {}) {
    const cfg = this.shop(shop);
    const lid = id(listingId, 'listing_id');
    let snapshot = null;
    if (backup) snapshot = (await this.snapshotListing(lid, { shop: cfg.alias })).data.file;
    const result = await this.request({
      shop: cfg.alias,
      method: 'DELETE',
      apiPath: `/application/listings/${lid}`,
      operation: 'listing.delete',
    });
    return { ...result, backup: snapshot };
  }

  async getPersonalization(listingId, { shop = null } = {}) {
    return this.request({ shop, apiPath: `/application/listings/${id(listingId, 'listing_id')}/personalization`, operation: 'personalization.get' });
  }

  async setPersonalization(listingId, questions, { shop = null, backup = true } = {}) {
    const cfg = this.shop(shop);
    const lid = id(listingId, 'listing_id');
    const preflightQuestions = validatePersonalizationQuestions(questions);
    let snapshot = null;
    let existingQuestions = [];

    if (backup) {
      const captured = (await this.snapshotListing(lid, { shop: cfg.alias })).data;
      snapshot = captured.file;
      existingQuestions = captured.snapshot.personalization?.personalization_questions || [];
    } else {
      const current = await this.getPersonalization(lid, { shop: cfg.alias });
      existingQuestions = current.data?.personalization_questions || [];
    }

    const preparedQuestions = validatePersonalizationQuestions(
      preserveExistingAddOnPrices(preflightQuestions, existingQuestions),
    );

    const result = await this.request({
      shop: cfg.alias,
      method: 'POST',
      apiPath: `/application/shops/${cfg.shop_id}/listings/${lid}/personalization`,
      query: { supports_multiple_personalization_questions: 'true' },
      body: { personalization_questions: preparedQuestions },
      operation: 'personalization.set',
    });
    return { ...result, backup: snapshot };
  }

  async deletePersonalization(listingId, { shop = null, backup = true } = {}) {
    const cfg = this.shop(shop);
    const lid = id(listingId, 'listing_id');
    let snapshot = null;
    if (backup) snapshot = (await this.snapshotListing(lid, { shop: cfg.alias })).data.file;
    const result = await this.request({
      shop: cfg.alias, method: 'DELETE',
      apiPath: `/application/shops/${cfg.shop_id}/listings/${lid}/personalization`,
      operation: 'personalization.delete',
    });
    return { ...result, backup: snapshot };
  }

  async getInventory(listingId, { shop = null } = {}) {
    return this.request({ shop, apiPath: `/application/listings/${id(listingId, 'listing_id')}/inventory`, operation: 'inventory.get' });
  }

  async setInventory(listingId, inventory, { shop = null, backup = true } = {}) {
    const cfg = this.shop(shop);
    const lid = id(listingId, 'listing_id');
    let snapshot = null;
    if (backup) snapshot = (await this.snapshotListing(lid, { shop: cfg.alias })).data.file;
    const result = await this.request({
      shop: cfg.alias, method: 'PUT',
      apiPath: `/application/listings/${lid}/inventory`,
      query: { legacy: 'false', max_variations_supported: 3 }, body: inventory, operation: 'inventory.set',
    });
    return { ...result, backup: snapshot };
  }

  async listReceipts({
    shop = null,
    limit = 25,
    offset = 0,
    minCreated = undefined,
    maxCreated = undefined,
    minLastModified = undefined,
    maxLastModified = undefined,
    sortOn = undefined,
    sortOrder = undefined,
    wasPaid = undefined,
    wasShipped = undefined,
    wasDelivered = undefined,
    wasCanceled = undefined,
    legacy = undefined,
  } = {}) {
    const cfg = this.shop(shop);
    return this.request({
      shop: cfg.alias,
      apiPath: `/application/shops/${cfg.shop_id}/receipts`,
      query: {
        limit,
        offset,
        min_created: minCreated,
        max_created: maxCreated,
        min_last_modified: minLastModified,
        max_last_modified: maxLastModified,
        sort_on: sortOn,
        sort_order: sortOrder,
        was_paid: wasPaid,
        was_shipped: wasShipped,
        was_delivered: wasDelivered,
        was_canceled: wasCanceled,
        legacy,
      },
      operation: 'orders.list',
    });
  }

  async getReceipt(receiptId, { shop = null } = {}) {
    const cfg = this.shop(shop);
    return this.request({
      shop: cfg.alias,
      apiPath: `/application/shops/${cfg.shop_id}/receipts/${id(receiptId, 'receipt_id')}`,
      operation: 'orders.get',
    });
  }

  async listImages(listingId, { shop = null } = {}) {
    return this.request({ shop, apiPath: `/application/listings/${id(listingId, 'listing_id')}/images`, operation: 'images.list' });
  }

  async uploadImage(listingId, filePath, { shop = null, rank = undefined, altText = undefined, overwrite = undefined, backup = true } = {}) {
    const cfg = this.shop(shop);
    const lid = id(listingId, 'listing_id');
    let snapshot = null;
    if (backup) snapshot = (await this.snapshotListing(lid, { shop: cfg.alias })).data.file;
    const result = await this.request({
      shop: cfg.alias, method: 'POST',
      apiPath: `/application/shops/${cfg.shop_id}/listings/${lid}/images`,
      form: { rank, alt_text: altText, overwrite },
      files: [{ field: 'image', path: filePath }],
      operation: 'images.upload',
    });
    return { ...result, backup: snapshot };
  }

  async getImage(listingId, imageId, { shop = null } = {}) {
    return this.request({
      shop,
      apiPath: `/application/listings/${id(listingId, 'listing_id')}/images/${id(imageId, 'image_id')}`,
      operation: 'images.get',
    });
  }

  async deleteImage(listingId, imageId, { shop = null, backup = true } = {}) {
    const cfg = this.shop(shop);
    const lid = id(listingId, 'listing_id');
    const iid = id(imageId, 'image_id');
    let snapshot = null;
    if (backup) snapshot = (await this.snapshotListing(lid, { shop: cfg.alias })).data.file;
    const result = await this.request({
      shop: cfg.alias, method: 'DELETE',
      apiPath: `/application/shops/${cfg.shop_id}/listings/${lid}/images/${iid}`,
      operation: 'images.delete',
    });
    return { ...result, backup: snapshot };
  }

  async uploadImageData(listingId, file, { shop = null, listingImageId = undefined, rank = undefined, overwrite = undefined, isWatermarked = undefined, altText = undefined, backup = true } = {}) {
    const cfg = this.shop(shop);
    const lid = id(listingId, 'listing_id');
    let snapshot = null;
    if (backup) snapshot = (await this.snapshotListing(lid, { shop: cfg.alias })).data.file;
    const files = file ? [{ field: 'image', ...file }] : null;
    const result = await this.request({
      shop: cfg.alias,
      method: 'POST',
      apiPath: `/application/shops/${cfg.shop_id}/listings/${lid}/images`,
      form: { listing_image_id: listingImageId, rank, overwrite, is_watermarked: isWatermarked, alt_text: altText },
      files,
      multipart: true,
      operation: 'images.upload',
    });
    return { ...result, backup: snapshot };
  }

  async listVideos(listingId, { shop = null } = {}) {
    return this.request({ shop, apiPath: `/application/listings/${id(listingId, 'listing_id')}/videos`, operation: 'videos.list' });
  }

  async getVideo(listingId, videoId, { shop = null } = {}) {
    return this.request({ shop, apiPath: `/application/listings/${id(listingId, 'listing_id')}/videos/${id(videoId, 'video_id')}`, operation: 'videos.get' });
  }

  async uploadVideo(listingId, file, { shop = null, videoId = undefined, name = undefined, isMultiVideo = undefined, backup = true } = {}) {
    const cfg = this.shop(shop);
    const lid = id(listingId, 'listing_id');
    let snapshot = null;
    if (backup) snapshot = (await this.snapshotListing(lid, { shop: cfg.alias })).data.file;
    const files = file ? [{ field: 'video', ...file, name: name || file.name }] : null;
    const result = await this.request({
      shop: cfg.alias,
      method: 'POST',
      apiPath: `/application/shops/${cfg.shop_id}/listings/${lid}/videos`,
      query: { is_multi_video: isMultiVideo },
      form: { video_id: videoId, name: name || file?.name },
      files,
      multipart: true,
      operation: 'videos.upload',
    });
    return { ...result, backup: snapshot };
  }

  async deleteVideo(listingId, videoId, { shop = null, backup = true } = {}) {
    const cfg = this.shop(shop);
    const lid = id(listingId, 'listing_id');
    const vid = id(videoId, 'video_id');
    let snapshot = null;
    if (backup) snapshot = (await this.snapshotListing(lid, { shop: cfg.alias })).data.file;
    const result = await this.request({ shop: cfg.alias, method: 'DELETE', apiPath: `/application/shops/${cfg.shop_id}/listings/${lid}/videos/${vid}`, operation: 'videos.delete' });
    return { ...result, backup: snapshot };
  }

  async listFiles(listingId, { shop = null } = {}) {
    const cfg = this.shop(shop);
    return this.request({ shop: cfg.alias, apiPath: `/application/shops/${cfg.shop_id}/listings/${id(listingId, 'listing_id')}/files`, operation: 'files.list' });
  }

  async getFile(listingId, listingFileId, { shop = null } = {}) {
    const cfg = this.shop(shop);
    return this.request({
      shop: cfg.alias,
      apiPath: `/application/shops/${cfg.shop_id}/listings/${id(listingId, 'listing_id')}/files/${id(listingFileId, 'listing_file_id')}`,
      operation: 'files.get',
    });
  }

  async uploadFile(listingId, file, { shop = null, listingFileId = undefined, name = undefined, rank = undefined, backup = true } = {}) {
    const cfg = this.shop(shop);
    const lid = id(listingId, 'listing_id');
    let snapshot = null;
    if (backup) snapshot = (await this.snapshotListing(lid, { shop: cfg.alias })).data.file;
    const files = file ? [{ field: 'file', ...file, name: name || file.name }] : null;
    const result = await this.request({
      shop: cfg.alias,
      method: 'POST',
      apiPath: `/application/shops/${cfg.shop_id}/listings/${lid}/files`,
      form: { listing_file_id: listingFileId, name: name || file?.name, rank },
      files,
      multipart: true,
      operation: 'files.upload',
    });
    return { ...result, backup: snapshot };
  }

  async deleteFile(listingId, listingFileId, { shop = null, backup = true } = {}) {
    const cfg = this.shop(shop);
    const lid = id(listingId, 'listing_id');
    const fid = id(listingFileId, 'listing_file_id');
    let snapshot = null;
    if (backup) snapshot = (await this.snapshotListing(lid, { shop: cfg.alias })).data.file;
    const result = await this.request({ shop: cfg.alias, method: 'DELETE', apiPath: `/application/shops/${cfg.shop_id}/listings/${lid}/files/${fid}`, operation: 'files.delete' });
    return { ...result, backup: snapshot };
  }
}
