import AffUser from "../models/aff-user.js";
import Domains from "../models/domainSchema.js";
import { Platform } from "../models/platformSchema.js";
import { Product } from "../models/productSchema.js";
import { normalizeStoreUrl } from "../helper/domain-existence.js";

async function loadPlatformContext() {
  const users = await AffUser.find({}, { _id: 1, userType: 1 }).lean();
  const userIds = new Set(users.map((user) => String(user._id)));
  const platforms = await Platform.find({});
  const livePlatforms = platforms.filter((platform) =>
    userIds.has(String(platform.adminId))
  );
  const superAdmin = users.find((user) => user.userType === "SUPER_ADMIN");
  const superPlatform = livePlatforms.find(
    (platform) => superAdmin && String(platform.adminId) === String(superAdmin._id)
  );

  return {
    platforms,
    liveDomains: new Set(
      livePlatforms.map((platform) => normalizeStoreUrl(platform.domain)).filter(Boolean)
    ),
    fallback: normalizeStoreUrl(superPlatform?.domain),
  };
}

export async function isLivePlatformDomain(domain) {
  const normalized = normalizeStoreUrl(domain);
  if (!normalized) return false;
  const { liveDomains } = await loadPlatformContext();
  return liveDomains.has(normalized);
}

/**
 * Trailing-slash variants of the same store were stored as different domains,
 * and product rows were left behind after their admin was deleted.
 * Point those rows at the live super-admin store and replace the global
 * productId unique index with a per-store unique index.
 */
export async function repairAffiliateProductDomains() {
  const { platforms, liveDomains, fallback } = await loadPlatformContext();

  for (const platform of platforms) {
    const normalized = normalizeStoreUrl(platform.domain);
    if (normalized && platform.domain !== normalized) {
      platform.domain = normalized;
      await platform.save();
      if (liveDomains.has(normalized) || liveDomains.has(platform.domain)) {
        liveDomains.add(normalized);
      }
    }
  }

  const domainDocs = await Domains.find({});
  for (const doc of domainDocs) {
    const normalized = normalizeStoreUrl(doc.url);
    if (!normalized || doc.url === normalized) continue;
    const clash = await Domains.findOne({
      url: normalized,
      _id: { $ne: doc._id },
    }).lean();
    if (clash) continue;
    doc.url = normalized;
    await doc.save();
  }

  if (fallback) {
    const products = await Product.find({}, { domain: 1 }).lean();
    let moved = 0;
    for (const product of products) {
      const normalized = normalizeStoreUrl(product.domain);
      const next = liveDomains.has(normalized) ? normalized : fallback;
      if (next && product.domain !== next) {
        await Product.updateOne({ _id: product._id }, { $set: { domain: next } });
        moved += 1;
      }
    }
    if (moved > 0) {
      console.info(
        `[affiliate] moved ${moved} product row(s) onto ${fallback}`
      );
    }
  }

  await Product.syncIndexes();
}

export async function upsertAffiliateProduct({ productId, domain, fields }) {
  const normalizedDomain = normalizeStoreUrl(domain);
  if (!productId || !normalizedDomain) {
    return null;
  }

  const payload = {
    ...fields,
    productId: String(productId),
    domain: normalizedDomain,
  };

  const updated = await Product.findOneAndUpdate(
    {
      productId: String(productId),
      domain: { $in: [normalizedDomain, `${normalizedDomain}/`] },
    },
    { $set: payload },
    { new: true }
  );
  if (updated) return updated;

  const existing = await Product.findOne({ productId: String(productId) }).lean();
  if (existing) {
    const existingDomain = normalizeStoreUrl(existing.domain);
    const ownedByLiveStore =
      existingDomain !== normalizedDomain &&
      (await isLivePlatformDomain(existingDomain));

    if (!ownedByLiveStore) {
      return Product.findOneAndUpdate(
        { _id: existing._id },
        { $set: payload },
        { new: true }
      );
    }
  }

  try {
    return await Product.findOneAndUpdate(
      { productId: String(productId), domain: normalizedDomain },
      { $set: payload },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const conflict = await Product.findOne({ productId: String(productId) }).lean();
    if (!conflict) throw error;
    const conflictDomain = normalizeStoreUrl(conflict.domain);
    if (
      conflictDomain !== normalizedDomain &&
      (await isLivePlatformDomain(conflictDomain))
    ) {
      throw error;
    }
    return Product.findOneAndUpdate(
      { _id: conflict._id },
      { $set: payload },
      { new: true }
    );
  }
}
