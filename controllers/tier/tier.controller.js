import mongoose from "mongoose";
import { Tier } from "../../models/tier-models/tierSystemSchema.js";
import { validateTierLevels } from "../../utils/validators/validateTierLevels.js";
import { promoteNewStartingTier } from "../../services/tier/tierQueries.js";

// ================================================================ ///
// ================ CREATE AFFILIATE TIER ========================= ///
// ================================================================ ///

export const createAffiliateTierController = async (req, res, next) => {
  const admin = req.admin;

  if (!admin) {
    return res.status(401).json({ message: "Unauthorized: Admin not found" });
  }

  //   const allowedKeys = ["tierName", "description", "levels"];

  //   // ⭐ SAFE VALIDATION OF BODY KEYS
  //   validateBodyKeys(req.body, allowedKeys);

  // ⭐ VALIDATE BODY USING TIER SCHEMA
  //   validateBodyBySchema(req.body, Tier.schema);

  try {
    const { tierName, description, levels = [] } = req.body;

    //  1.. Validate required fields

    if (!tierName || tierName.trim() === "" || tierName.length === 0) {
      throw new Error("Tier name is required");
    }

    const existingTier = await Tier.findOne({
      adminId: admin._id,
      tierName: tierName.trim(),
    });

    if (existingTier) {
      throw new Error("Tier name must be unique");
    }

    // ⭐ SAFE VALIDATION CALL
    validateTierLevels(levels);

    // ⭐ GET LAST ORDER NUMBER
    const lastTier = await Tier.findOne({ adminId: admin._id })
      .sort({ order: -1 })
      .select("order");

    const nextOrder = lastTier ? lastTier.order + 1 : 1;

    const existingCount = await Tier.countDocuments({
      adminId: admin._id,
      platformId: admin.platformId,
    });
    const isStartingTier = existingCount === 0;

    // 2.. Create new tier object
    const newTier = new Tier({
      adminId: admin._id,
      platformId: admin.platformId,
      tierName: tierName.trim(),
      description: description || "",
      levels: levels,
      order: nextOrder,
      isStartingTier,
    });

    // 3.. Save to database
    const savedTier = await newTier.save();
    res.status(201).json({
      message: "Affiliate tier created successfully",
      data: savedTier,
    });
  } catch (error) {
    next(error);
  }
};
// ================================================================ ///

// ================================================================ ///
// ================ UPDATE AFFILIATE TIER ========================= ///
// ================================================================ ///

// export const updateAffiliateTierController = async (req, res, next) => {
//   try {
//     const { tierId } = req.params;
//     const { tierName, description, levels } = req.body;

//     if (!tierId) {
//       return res.status(400).json({ message: "Tier ID is required" });
//     }

//     const tier = await Tier.findById(tierId);

//     if (!tier) {
//       return res.status(404).json({ message: "Tier not found" });
//     }

//     /* -------------------- Update Basic Tier Fields -------------------- */

//     if (typeof tierName === "string" && tierName.trim() !== "") {
//       tier.tierName = tierName.trim();
//     }

//     if (typeof description === "string") {
//       tier.description = description;
//     }

//     /* -------------------- Update Levels Only If Provided -------------------- */
//     if (Array.isArray(levels)) {
//       for (const levelData of levels) {
//         const { _id, levelNumber, goals } = levelData;

//         /* -------------------- Update Existing Level -------------------- */
//         if (_id) {
//           const existingLevel = tier.levels.id(_id);
//           if (existingLevel) {
//             if (levelNumber !== undefined)
//               existingLevel.levelNumber = levelNumber;
//             if (Array.isArray(goals)) {
//               existingLevel.goals = goals; // Replace goals 1:1 as frontend sends
//             }
//           }
//         } else {
//           /* -------------------- Add New Level -------------------- */
//           tier.levels.push({
//             levelNumber,
//             goals: Array.isArray(goals) ? goals : [],
//             createdAt: new Date(),
//           });
//         }
//       }
//     }

//     await tier.save();

//     return res.status(200).json({
//       message: "Tier updated successfully",
//       tier,
//     });
//   } catch (error) {
//     next(error);
//   }
// };
export const updateAffiliateTierController = async (req, res, next) => {
  try {
    const { tierId } = req.params;
    const { tierName, description, levels } = req.body;

    if (!tierId) {
      return res.status(400).json({ message: "Tier ID is required" });
    }

    const tier = await Tier.findById(tierId);
    if (!tier) {
      return res.status(404).json({ message: "Tier not found" });
    }

    // Update basic fields
    if (tierName) tier.tierName = tierName;
    if (description) tier.description = description;

    // 🔥 Completely replace levels (correct way)
    if (Array.isArray(levels)) {
      tier.levels = levels;
    }

    await tier.save();

    return res.status(200).json({
      message: "Tier updated successfully",
      tier,
    });

  } catch (error) {
    next(error);
  }
};


// ================================================================ ///

// ================================================================ ///
// ================ DELETE AFFILIATE TIER ========================= ///
// ================================================================ ///

export const deleteAffiliateTierController = async (req, res, next) => {
//   console.log("Delete Tier Controller Invoked");

  try {
    const { tierId } = req.params;
    const admin = req.admin;

    if (!admin) {
      throw new Error("Unauthorized: Admin not found");
    }

    if (!mongoose.Types.ObjectId.isValid(tierId)) {
      return res.status(400).json({
        message: "Invalid Tier ID format",
      });
    }

    const tier = await Tier.findOne({ _id: tierId, adminId: admin._id });

    if (!tier) {
      throw new Error("Tier not found or unauthorized");
    }

    const deletedOrder = tier.order;
    const wasStartingTier = tier.isStartingTier;
    const platformId = tier.platformId;

    await Tier.deleteOne({ _id: tierId });

    await Tier.updateMany(
      { adminId: admin._id, order: { $gt: deletedOrder } },
      { $inc: { order: -1 } }
    );

    if (wasStartingTier) {
      await promoteNewStartingTier(admin._id, platformId);
    }

    return res.status(200).json({
      message: "Tier deleted & order rearranged",
    });
  } catch (error) {
    next(error);
  }
};

// ================================================================ ///

// ================================================================ ///
// ================ TOGGLE AFFILIATE TIER ========================= ///
// ================================================================ ///

export const toggleAffiliateTierStatusController = async (req, res, next) => {
  try {
    const { tierId } = req.params;
    const admin = req.admin;

    if (!tierId) {
      return res.status(400).json({ message: "Tier ID is required" });
    }

    // Direct DB toggle (no validation)
    const tier = await Tier.findOneAndUpdate(
      { _id: tierId, adminId: admin._id },
      [
        { $set: { isActive: { $not: "$isActive" } } }
      ],
      { new: true, runValidators: false }
    );
    

    if (!tier) {
      return res.status(404).json({ message: "Tier not found" });
    }

    return res.status(200).json({
      message: `Tier has been ${tier.isActive ? "enabled" : "disabled"} successfully`,
      data: {
        isActive: tier.isActive,
      },
    });
  } catch (error) {
    next(error);
  }
};


// ================================================================ ///
