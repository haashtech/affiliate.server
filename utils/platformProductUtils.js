// import axios from "axios";
// import { Product } from "../models/productSchema.js";

// /**
//  * Fetches platform products and validates product activity status.
//  * 
//  * - If local product exists → must have correct domain + active status
//  * - If local product does not exist → still treated as valid
//  */
// export const getAndValidatePlatformProducts = async (
//   backendUrl,
//   productIdsArray,
//   platformDomain
// ) => {
//   const validProducts = [];
//   const blockedProducts = [];

//   let platformProducts = [];
//   try {
//     const response = await axios.get(backendUrl);
//     platformProducts = response.data?.data || response.data || [];
//   } catch (err) {
//     console.warn("⚠️ Platform fetch failed (skipped sync check):", err.message);
//   }

//   for (const id of productIdsArray) {
//     // Find product from platform response (optional context)
//     const foundInPlatform = platformProducts.find(
//       (p) => p.productId?.toString() === id.toString()
//     );

//     // Check local DB version (if it exists)
//     const localProduct = await Product.findOne({ productId: id });

//     if (localProduct) {
//       if (localProduct.domain !== platformDomain) {
//         blockedProducts.push({ productId: id, reason: "Product domain mismatch" });
//         continue;
//       }

//       if (!localProduct.isActive || localProduct.status === "PAUSED") {
//         blockedProducts.push({ productId: id, reason: "Product inactive or paused" });
//         continue;
//       }
//     }

//     // ✅ Always add if passed checks (even if not found in local DB)
//     validProducts.push(foundInPlatform || { productId: id, localRef: localProduct });
//   }

//   return { validProducts, blockedProducts };
// };

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

    const localProduct = await Product.findOne({ productId });

    if (localProduct) {
      if (localProduct.domain !== platformDomain) {
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
