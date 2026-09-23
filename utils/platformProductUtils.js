import { Product } from "../models/productSchema.js";
import { fetchPlatformProducts } from "./fetchPlatformProducts.js";

/**
 * Fetches platform products and validates product activity status.
 *
 * - Takes productDetails [{ productId, productAmount }]
 * - Only blocks if local product exists but is inactive/paused or mismatched domain
 * - Returns valid products + total valid productAmount
 */
export const getAndValidatePlatformProducts = async (
  backendUrl,
  productDetails,
  platformDomain
) => {
  const validProducts = [];
  const blockedProducts = [];
  let totalValidAmount = 0;

  let platformProducts = [];
  try {
    platformProducts = await fetchPlatformProducts(backendUrl);
  } catch (err) {
    console.warn("⚠️ Platform fetch failed (skipped sync check):", err.message);
  }

  for (const item of productDetails) {
    const { productId, productAmount } = item;

    const foundInPlatform = platformProducts.find(
      (p) => p.productId?.toString() === productId.toString()
    );

    // Prefer the platform's own row; productId is globally unique so a
    // miss can still resolve the shared affiliate Product (e.g. Example).
    let localProduct = await Product.findOne({
      productId,
      domain: platformDomain,
    });
    const foundByExactDomain = Boolean(localProduct);
    if (!localProduct) {
      localProduct = await Product.findOne({ productId });
    }

    if (localProduct) {
      if (foundByExactDomain && localProduct.domain !== platformDomain) {
        blockedProducts.push({ productId, reason: "Product domain mismatch" });
        continue;
      }

      if (!localProduct.isActive || localProduct.status === "PAUSED") {
        blockedProducts.push({ productId, reason: "Product inactive or paused" });
        continue;
      }
    }

    // ✅ Passed checks (or no local record)
    validProducts.push({
      ...foundInPlatform,
      localRef: localProduct,
      productId,
      productAmount,
    });
    totalValidAmount += Number(productAmount) || 0;
  }

  return { validProducts, blockedProducts, totalValidAmount };
};
