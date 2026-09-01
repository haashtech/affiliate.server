import { Tier } from "../../models/tier-models/tierSystemSchema.js";

/**
 * First active level on a tier (Level 1 preferred).
 */
export function getFirstActiveLevel(tier) {
  if (!tier?.levels?.length) return null;
  return (
    tier.levels.find((l) => l.isActive && l.levelNumber === 1) ||
    tier.levels.find((l) => l.isActive) ||
    null
  );
}

/**
 * Legacy tiers: mark the lowest-order active tier as starting (once per admin/platform).
 */
export async function backfillStartingTierIfNeeded(adminId, platformId) {
  const hasStarting = await Tier.exists({
    adminId,
    platformId,
    isStartingTier: true,
  });
  if (hasStarting) return;

  const first = await Tier.findOne({
    adminId,
    platformId,
    isActive: true,
  }).sort({ order: 1 });

  if (!first) return;

  await Tier.updateMany(
    { adminId, platformId },
    { $set: { isStartingTier: false } }
  );
  first.isStartingTier = true;
  await first.save();
}

/**
 * Starting tier for NEW affiliates only — uses isStartingTier, not latest/highest order.
 */
export async function getStartingTier(adminId, platformId) {
  await backfillStartingTierIfNeeded(adminId, platformId);

  return Tier.findOne({
    adminId,
    platformId,
    isStartingTier: true,
    isActive: true,
  });
}

/**
 * Next tier after the current one completes (progression only).
 */
export async function getNextTier(adminId, platformId, currentOrder) {
  return Tier.findOne({
    adminId,
    platformId,
    order: { $gt: currentOrder },
    isActive: true,
  }).sort({ order: 1 });
}

/**
 * After deleting the starting tier, promote the lowest remaining order tier.
 */
export async function promoteNewStartingTier(adminId, platformId) {
  const next = await Tier.findOne({ adminId, platformId }).sort({ order: 1 });
  if (!next) return;

  await Tier.updateMany(
    { adminId, platformId },
    { $set: { isStartingTier: false } }
  );
  next.isStartingTier = true;
  await next.save();
}
