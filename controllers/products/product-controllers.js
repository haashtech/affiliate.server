import { Campaign } from "../../models/campaignSchema.js";
import { Platform } from "../../models/platformSchema.js";
import { Product } from "../../models/productSchema.js";
import { fetchPlatformProducts } from "../../utils/fetchPlatformProducts.js";
/**
 * @desc Get all products (optionally filtered by domain/status)
 * @route GET /api/products
 */
export const getProductsFromDb = async (req, res) => {
  try {
    const { domain, status } = req.query;
    const filter = {};
    if (domain) filter.domain = domain;
    if (status) filter.status = status;

    const products = await Product.find(filter).sort({ createdAt: -1 });

    return res.json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (error) {
    console.error("Error fetching products:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching products",
      error: error.message,
    });
  }
};

/**
 * @desc Add or update multiple products
 * @route POST /api/products
 */
export const updateProductsToDb = async (req, res) => {
  try {
    const { products } = req.body;

    if (!Array.isArray(products) || products.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No products provided" });
    }

    // <-------- for without check single updates only ------->
    // for (const prod of products) {
    //   const { productId, domain, ...fields } = prod;
    //   if (!productId || !domain) continue;

    //   await Product.findOneAndUpdate(
    //     { productId, domain },
    //     { $set: fields },
    //     { upsert: true, new: true }
    //   );
    // }
    // <-------- for without check single updates only ------->

    for (const prod of products) {
      const { productId, domain, ...fields } = prod;

      if (productId && domain) {
        // update specific product
        await Product.findOneAndUpdate(
          { productId, domain },
          { $set: fields },
          { upsert: true, new: true }
        );
      } else {
        // update all products
        await Product.updateMany({}, { $set: fields });
      }
    }

    return res.json({
      success: true,
      message: "Products updated successfully",
    });
  } catch (error) {
    console.error("Error updating products:", error);
    return res.status(500).json({
      success: false,
      message: "Error updating products",
      error: error.message,
    });
  }
};

/**
 * @desc Update a single product’s commission
 * @route PATCH /api/products/:id
 */
export const updateProductCommission = async (req, res) => {
  try {
    const { id } = req.params;
    const { commission } = req.body;

    if (commission === undefined)
      return res
        .status(400)
        .json({ success: false, message: "Commission value required" });

    const product = await Product.findByIdAndUpdate(
      id,
      { commission },
      { new: true }
    );

    if (!product)
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });

    return res.json({
      success: true,
      message: "Commission updated successfully",
      data: product,
    });
  } catch (error) {
    console.error("Error updating commission:", error);
    return res.status(500).json({
      success: false,
      message: "Error updating commission",
      error: error.message,
    });
  }
};

/**
 * @desc Update a single product’s status
 * @route PATCH /api/products/:id/status
 */

export const updateProductStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, isActive } = req.body;

    // Validate status if provided
    if (status && !["ACTIVE", "PAUSED"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Valid status value required (ACTIVE or PAUSED)",
      });
    }

    // Validate isActive if provided
    if (isActive !== undefined && typeof isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "Active must be a boolean value",
      });
    }

    // Build update object dynamically
    const updateFields = {};
    if (status) updateFields.status = status;
    if (isActive !== undefined) updateFields.isActive = isActive;

    const product = await Product.findByIdAndUpdate(id, updateFields, {
      new: true,
    });

    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }

    return res.json({
      success: true,
      message: `Product updated successfully`,
      data: product,
    });
  } catch (error) {
    console.error("Error updating product status:", error);
    return res.status(500).json({
      success: false,
      message: "Error updating product status",
      error: error.message,
    });
  }
};

// =========================== get product for user with product route and schema ===========================
/**
 * @desc Get all products (optionally filtered by domain/status)
 * @route GET /api/products
 */
export const getProductsForUsersFromDb = async (req, res) => {
  try {
    const {
      categoryId,
      productId,
      color,
      size,
      minPrice,
      maxPrice,
      sort,
    } = req.query;

    const { adminId } = req.params;

    /* --------------------------------------------------
       1️⃣ PLATFORM CONFIG
    -------------------------------------------------- */
    let platform;

    if (adminId) {
      platform = await Platform.findOne({ adminId });
    }

    if (!platform) {
      platform = await Platform.findOne({ adminType: "SUPER_ADMIN" });
    }

    if (!platform) {
      return res.status(404).json({ message: "No valid platform found" });
    }

    const productsUrl = platform.backendRoutes?.products;
    if (!productsUrl) {
      return res
        .status(400)
        .json({ message: "No products URL found in backendRoutes" });
    }

    /* --------------------------------------------------
       2️⃣ FETCH EXTERNAL PRODUCTS
    -------------------------------------------------- */
    let externalProducts;

    try {
      externalProducts = await fetchPlatformProducts(productsUrl);
    } catch (error) {
      const status = error.response?.status || 502;
      return res.status(status).json({
        message: "Failed to fetch products from store",
        error: error.response?.data?.message || error.message,
      });
    }

    externalProducts = Array.isArray(externalProducts) ? externalProducts : [];

    /* --------------------------------------------------
       3️⃣ FETCH LOCAL PRODUCTS
    -------------------------------------------------- */
    const localProducts = await Product.find(
      {},
      { productId: 1, isActive: 1, commission: 1 }
    ).lean();

    const localProductMap = new Map();
    localProducts.forEach((p) => {
      if (p?.productId == null) return;
      localProductMap.set(p.productId.toString(), p);
    });

    /* --------------------------------------------------
       4️⃣ USER & COMMISSION CONTEXT
    -------------------------------------------------- */
    const user = req.user;

    const userAffType = user?.affType;
    const platformCommission = platform?.commission || 0;

    /* --------------------------------------------------
       5️⃣ FILTER + ENRICH PRODUCTS (FIXED)
    -------------------------------------------------- */
    let products = externalProducts
      .filter((external) => {
        const local = localProductMap.get(external._id?.toString());

        if (local && local.isActive === false) return false;

        return true;
      })
      .map((external) => {
        const local = localProductMap.get(external._id?.toString());

        let commission = platformCommission;

        // 🔥 RULE 1: NON-INDIVIDUAL USERS
        if (userAffType?.type !== "INDIVIDUAL") {
          commission = userAffType?.commission ?? platformCommission;
        }
        // 🔥 RULE 2: INDIVIDUAL USERS
        else {
          if (local?.commission && local.commission > 0) {
            commission = local.commission;
          } else {
            commission = platformCommission;
          }
        }

        return {
          ...external,
          commission,
        };
      });

    /* --------------------------------------------------
       6️⃣ CATEGORY EXTRACTION
    -------------------------------------------------- */
    const categoryMap = new Map();
    externalProducts.forEach((p) => {
      const cat = p.categoryId;
      if (cat && cat._id && !categoryMap.has(cat._id)) {
        categoryMap.set(cat._id, {
          _id: cat._id,
          name: cat.name,
          slug: cat.slug,
          banner: cat.banner,
          categoryIcon: cat.categoryIcon,
          coverImage: cat.coverImage,
        });
      }
    });

    const categories = Array.from(categoryMap.values());

    /* --------------------------------------------------
       7️⃣ FILTERS
    -------------------------------------------------- */
    if (categoryId) {
      products = products.filter(
        (p) => p.categoryId?._id?.toString() === categoryId
      );
    }

    if (productId) {
      products = products.filter((p) => p._id?.toString() === productId);
    }

    if (color) {
      const colorArray = color.split(",");
      products = products.filter((p) =>
        p.variations?.some((v) =>
          colorArray.includes(v.colorName?.toLowerCase())
        )
      );
    }

    if (size) {
      const sizeArray = size.split(",");
      products = products.filter((p) =>
        p.variations?.some((v) =>
          v.sizeArray?.some((s) => sizeArray.includes(s.size))
        )
      );
    }

    if (minPrice || maxPrice) {
      products = products.filter(
        (p) =>
          p.mrp >= Number(minPrice || 0) &&
          p.mrp <= Number(maxPrice || 999999)
      );
    }

    /* --------------------------------------------------
       8️⃣ SORTING
    -------------------------------------------------- */
    if (sort === "price_asc") {
      products.sort((a, b) => a.mrp - b.mrp);
    } else if (sort === "price_desc") {
      products.sort((a, b) => b.mrp - a.mrp);
    } else if (sort === "best_selling") {
      products.sort((a, b) => b.numberOfReviews - a.numberOfReviews);
    }

    /* --------------------------------------------------
       9️⃣ CAMPAIGN FLAG
    -------------------------------------------------- */
    if (user) {
      const userCampaigns = await Campaign.find({
        userId: user._id,
        status: "ACTIVE",
      });

      const campaignProductIds = userCampaigns
        .map((c) => c.product?.productId)
        .filter((id) => id != null)
        .map((id) => id.toString());

      products = products.map((p) => ({
        ...p,
        campaignProduct: p._id
          ? campaignProductIds.includes(p._id.toString())
          : false,
      }));
    } else {
      products = products.map((p) => ({
        ...p,
        campaignProduct: false,
      }));
    }

    /* --------------------------------------------------
       🔟 FINAL RESPONSE
    -------------------------------------------------- */
    return res.status(200).json({
      message: "Products fetched successfully",
      data: {
        products,
        platform,
        categories,
      },
    });
  } catch (error) {
    console.error("Error fetching products:", error);
    return res.status(500).json({
      message: "Internal Server Error",
      error: error?.message || String(error),
      name: error?.name,
    });
  }
};


// export const getProductsForUsersFromDb = async (req, res) => {
//   try {
//     const {
//       categoryId,
//       productId,
//       color,
//       size,
//       minPrice,
//       maxPrice,
//       sort,
//     } = req.query;

//     const { adminId } = req.params;

//     /* --------------------------------------------------
//        1️⃣ PLATFORM CONFIG
//     -------------------------------------------------- */
//     let platform;

//     if (adminId) {
//       platform = await Platform.findOne({ adminId });
//     }

//     if (!platform) {
//       platform = await Platform.findOne({ adminType: "SUPER_ADMIN" });
//     }

//     if (!platform) {
//       return res.status(404).json({ message: "No valid platform found" });
//     }

//     const productsUrl = platform.backendRoutes?.products;
//     if (!productsUrl) {
//       return res
//         .status(400)
//         .json({ message: "No products URL found in backendRoutes" });
//     }

//     /* --------------------------------------------------
//        2️⃣ FETCH EXTERNAL PRODUCTS (SOURCE OF TRUTH)
//     -------------------------------------------------- */
//     const externalProductsResponse = await axios.get(productsUrl, {
//       withCredentials: true,
//     });

//     const externalProducts = externalProductsResponse.data || [];

//     /* --------------------------------------------------
//        3️⃣ FETCH LOCAL PRODUCTS (ONLY REQUIRED FIELDS)
//     -------------------------------------------------- */
//     const localProducts = await Product.find(
//       {},
//       { productId: 1, isActive: 1, commission: 1 }
//     ).lean();

//     /* --------------------------------------------------
//        4️⃣ BUILD LOOKUP MAP (O(1))
//     -------------------------------------------------- */
//     const localProductMap = new Map();
//     localProducts.forEach((p) => {
//       localProductMap.set(p.productId.toString(), p);
//     });

//     /* --------------------------------------------------
//        5️⃣ FILTER + ENRICH PRODUCTS
//     -------------------------------------------------- */
//     let products = externalProducts
//       .filter((external) => {
//         const local = localProductMap.get(external._id?.toString());

//         // ❌ Hide if explicitly inactive
//         if (local && local.isActive === false) return false;

//         return true;
//       })
//       .map((external) => {
//         const local = localProductMap.get(external._id?.toString());

//         return {
//           ...external,
//           commission: local?.commission ?? 0, // ✅ enrich
//         };
//       });

//     /* --------------------------------------------------
//        6️⃣ CATEGORY EXTRACTION (FROM ALL EXTERNAL PRODUCTS)
//     -------------------------------------------------- */
//     const categoryMap = new Map();
//     externalProducts.forEach((p) => {
//       const cat = p.categoryId;
//       if (cat && cat._id && !categoryMap.has(cat._id)) {
//         categoryMap.set(cat._id, {
//           _id: cat._id,
//           name: cat.name,
//           slug: cat.slug,
//           banner: cat.banner,
//           categoryIcon: cat.categoryIcon,
//           coverImage: cat.coverImage,
//         });
//       }
//     });

//     const categories = Array.from(categoryMap.values());

//     /* --------------------------------------------------
//        7️⃣ FILTERS
//     -------------------------------------------------- */
//     if (categoryId) {
//       products = products.filter(
//         (p) => p.categoryId?._id?.toString() === categoryId
//       );
//     }

//     if (productId) {
//       products = products.filter((p) => p._id?.toString() === productId);
//     }

//     if (color) {
//       const colorArray = color.split(",");
//       products = products.filter((p) =>
//         p.variations?.some((v) =>
//           colorArray.includes(v.colorName?.toLowerCase())
//         )
//       );
//     }

//     if (size) {
//       const sizeArray = size.split(",");
//       products = products.filter((p) =>
//         p.variations?.some((v) =>
//           v.sizeArray?.some((s) => sizeArray.includes(s.size))
//         )
//       );
//     }

//     if (minPrice || maxPrice) {
//       products = products.filter(
//         (p) =>
//           p.mrp >= Number(minPrice || 0) &&
//           p.mrp <= Number(maxPrice || 999999)
//       );
//     }

//     /* --------------------------------------------------
//        8️⃣ SORTING
//     -------------------------------------------------- */
//     if (sort === "price_asc") {
//       products.sort((a, b) => a.mrp - b.mrp);
//     } else if (sort === "price_desc") {
//       products.sort((a, b) => b.mrp - a.mrp);
//     } else if (sort === "best_selling") {
//       products.sort((a, b) => b.numberOfReviews - a.numberOfReviews);
//     }

//     /* --------------------------------------------------
//        9️⃣ CAMPAIGN FLAG
//     -------------------------------------------------- */
//     const user = req.user;

//     if (user) {
//       const userCampaigns = await Campaign.find({
//         userId: user._id,
//         status: "ACTIVE",
//       });

//       const campaignProductIds = userCampaigns.map((c) =>
//         c.product.productId.toString()
//       );

//       products = products.map((p) => ({
//         ...p,
//         campaignProduct: campaignProductIds.includes(p._id.toString()),
//       }));
//     } else {
//       products = products.map((p) => ({
//         ...p,
//         campaignProduct: false,
//       }));
//     }

//     /* --------------------------------------------------
//        🔟 FINAL RESPONSE
//     -------------------------------------------------- */
//     return res.status(200).json({
//       message: "Products fetched successfully",
//       data: {
//         products,
//         platform,
//         categories,
//       },
//     });
//   } catch (error) {
//     console.error("Error fetching products:", error);
//     return res.status(500).json({
//       message: "Internal Server Error",
//       error: error.message,
//     });
//   }
// };

